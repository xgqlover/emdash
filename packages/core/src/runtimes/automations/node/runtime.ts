import { err, ok, type Result } from '@emdash/shared';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { createEventStreamHost, type EventStreamHost } from '@emdash/wire/live';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import { automationsContract } from '../api/contract';
import type { AutomationId } from '../api/deployment';
import type {
  CancelRunError,
  DeployError,
  RunReadError,
  RemoveError,
  StartRunError,
} from '../api/errors';
import { automationRunStatuses, type AutomationRun } from '../api/run';
import type {
  CancelRunInput,
  DeployInput,
  DeployResult,
  GetRunInput,
  GetRunOverviewInput,
  GetRunOverviewResult,
  GetRunResult,
  ListChangedRunsInput,
  ListChangedRunsResult,
  ListRunsInput,
  ListRunsResult,
  RemoveInput,
  StartRunInput,
  StartRunResult,
} from '../api/schemas';
import { LIST_CHANGED_RUNS_DEFAULT_LIMIT, LIST_RUNS_DEFAULT_LIMIT } from '../api/schemas';
import { AutomationDeploymentStore } from './persistence/deployment-store';
import { AutomationRunStore } from './persistence/run-store';
import type { AutomationsDb } from './persistence/store';
import type { AutomationSessionPort } from './ports/session-start';
import type { AutomationWorkspacePort } from './ports/workspace-provisioning';
import { createAutomationRunExecutor } from './runs/executor';
import { AutomationRunTransitions, type OnRunChanged } from './runs/transitions';
import { validateAutomationSchedule } from './scheduling/cron';
import { AutomationScheduler } from './scheduling/scheduler';
import { parseWebhookFilter } from './scheduling/webhook-filter';
import { AutomationWebhookServer, type WebhookTarget } from './webhook-server';

export type AutomationsRuntimeOptions = {
  handle: StoreHandle<AutomationsDb>;
  workspacePort: AutomationWorkspacePort;
  sessionPort: AutomationSessionPort;
  clock?: Clock;
  logger?: Logger;
  tickIntervalMs?: number;
  maxConcurrentRuns?: number;
  /**
   * [XG-CUSTOM 2026-10-05] 事件触发（webhook）摄取端口。缺省走 `AUTOMATION_WEBHOOK_DEFAULT_PORT`
   * （127.0.0.1:7823，可用 EMDASH_AUTOMATION_WEBHOOK_PORT 覆盖）；测试传 0 让系统分配。
   */
  webhookPort?: number;
};

export class AutomationsRuntime {
  private readonly deploymentStore: AutomationDeploymentStore;
  private readonly runStore: AutomationRunStore;
  private readonly transitions: AutomationRunTransitions;
  private readonly scheduler: AutomationScheduler;
  private readonly clock: Clock;
  private readonly activeAutomationIds = new Set<AutomationId>();
  /** [XG-CUSTOM 2026-10-05] 事件触发摄取端（只在存在 webhook 部署时监听） */
  private readonly webhookServer: AutomationWebhookServer;
  private allRunEventsActive = false;
  readonly runEventsHost: EventStreamHost<typeof automationsContract.runEvents>;

  constructor(options: AutomationsRuntimeOptions) {
    this.clock = options.clock ?? systemClock;
    const logger = options.logger ?? noopLogger;

    this.deploymentStore = new AutomationDeploymentStore(options.handle);
    this.runStore = new AutomationRunStore(options.handle);

    this.runEventsHost = createEventStreamHost(automationsContract.runEvents, {
      onActive: (key) => {
        if (key.automationId) this.activeAutomationIds.add(key.automationId);
        else this.allRunEventsActive = true;
      },
      onIdle: (key) => {
        if (key.automationId) this.activeAutomationIds.delete(key.automationId);
        else this.allRunEventsActive = false;
      },
    });

    const onRunChanged: OnRunChanged = (run) => {
      this.emitRunEvent(run);
    };

    this.transitions = new AutomationRunTransitions({
      runStore: this.runStore,
      onRunChanged,
    });

    // [XG-CUSTOM 2026-10-05] 事件触发摄取：**只绑 127.0.0.1**，没有 webhook 部署时不起监听；
    // 命中后与"手动点一下"走同一条造 run 的路，但来源记成 `webhook`（便于排查"谁触发的"）。
    this.webhookServer = new AutomationWebhookServer({
      listTargets: () => this.webhookTargets(),
      onEvent: (target) => {
        const deployment = this.deploymentStore.getDeployment(target.automationId);
        if (!deployment || !deployment.enabled) return;
        this.scheduler.runNow(deployment, 'webhook');
      },
      logger,
      port: options.webhookPort,
    });

    const executor = createAutomationRunExecutor({
      transitions: this.transitions,
      workspacePort: options.workspacePort,
      sessionPort: options.sessionPort,
    });

    this.scheduler = new AutomationScheduler({
      deploymentStore: this.deploymentStore,
      runStore: this.runStore,
      transitions: this.transitions,
      execute: executor,
      clock: this.clock,
      logger,
      tickIntervalMs: options.tickIntervalMs,
      maxConcurrentRuns: options.maxConcurrentRuns,
      onRunChanged,
    });
  }

  start(): void {
    this.scheduler.start();
    // 有 webhook 部署才真正起监听（ensureStarted 内部判空）
    void this.webhookServer.ensureStarted();
  }

  async dispose(): Promise<void> {
    this.webhookServer.stop();
    await this.scheduler.stop();
    this.runEventsHost.dispose();
  }

  /** 当前可被事件触发的目标（由已启用、且带 webhook 配置的部署生成） */
  private webhookTargets(): WebhookTarget[] {
    return this.deploymentStore
      .listEnabledDeployments()
      .filter((deployment) => deployment.webhook !== undefined)
      .map((deployment) => ({
        automationId: deployment.automationId,
        token: deployment.webhook!.token,
        filter: deployment.webhook!.filter,
      }));
  }

  /**
   * 部署变化后刷新摄取端（没有目标会自动停；有新目标会自动起）。
   * **await 它**：deploy 返回成功时监听就该已经就绪（否则调用方拿到 202 的期望会落空）。
   */
  private async refreshWebhookIntake(): Promise<void> {
    await this.webhookServer.ensureStarted();
  }

  /** 事件触发摄取端当前端口（0 = 没在监听）。可观测用，也方便测试直接发请求。 */
  get webhookListeningPort(): number {
    return this.webhookServer.listeningPort;
  }

  async deploy(input: DeployInput): Promise<Result<DeployResult, DeployError>> {
    const now = this.clock.now();
    // [XG-CUSTOM 2026-10-05] 两种触发源分开校验：cron 验表达式；webhook 验过滤表达式
    // （`schedule` 为 null 表示事件触发 —— 不排 cron 计划，由摄取端命中时 runNow(..., 'webhook')）
    if (input.webhook === undefined) {
      if (input.schedule === null) {
        return err({
          type: 'invalid-schedule',
          reason: 'malformed_expression',
          message: 'A deployment needs either a cron schedule or a webhook trigger',
        });
      }
      const scheduleError = validateAutomationSchedule(input.schedule, now);
      if (scheduleError) return err(scheduleError);
    } else {
      const parsed = parseWebhookFilter(input.webhook.filter ?? '');
      if (!parsed.ok) {
        return err({
          type: 'invalid-schedule',
          reason: 'invalid_expression_or_timezone',
          message: `Webhook filter is not valid: ${parsed.reason}`,
        });
      }
    }

    const stored = this.deploymentStore.upsertDeployment(input, now);
    this.scheduler.reconcile();
    await this.refreshWebhookIntake();
    return ok(stored);
  }

  async remove(input: RemoveInput): Promise<Result<void, RemoveError>> {
    const { automationId } = input;
    const existing = this.deploymentStore.getDeployment(automationId);
    if (!existing) {
      return err({
        type: 'automation-not-found',
        automationId,
        message: `Automation ${automationId} not found`,
      });
    }

    for (const run of this.runStore.listRunsInStatuses([
      'scheduled',
      'queued',
      'provisioning_workspace',
      'starting_session',
    ])) {
      if (run.automationId !== automationId) continue;
      this.scheduler.cancelRun(run.id);
    }
    this.runStore.deleteRunsForAutomation(automationId);
    this.deploymentStore.removeDeployment(automationId);
    // 移除后重新算摄取目标（没有目标会自动停监听）
    await this.refreshWebhookIntake();
    return ok(undefined);
  }

  async startRun(input: StartRunInput): Promise<Result<StartRunResult, StartRunError>> {
    const { automationId } = input;
    const deployment = this.deploymentStore.getDeployment(automationId);
    if (!deployment) {
      return err({
        type: 'automation-not-found',
        automationId,
        message: `Automation ${automationId} not found`,
      });
    }
    if (!deployment.enabled) {
      return err({
        type: 'automation-disabled',
        automationId,
        message: `Automation ${automationId} is disabled`,
      });
    }
    const run = this.scheduler.runNow(deployment);
    return ok({ run });
  }

  cancelRun(input: CancelRunInput): Result<void, CancelRunError> {
    const { automationId, runId } = input;
    const run = this.runStore.getRun(runId);
    if (!run || run.automationId !== automationId) {
      return err({
        type: 'run-not-found',
        runId,
        message: `Run ${runId} not found`,
      });
    }
    if (!this.scheduler.cancelRun(runId)) {
      return err({
        type: 'run-not-found',
        runId,
        message: `Run ${runId} not found`,
      });
    }
    return ok(undefined);
  }

  getRun(input: GetRunInput): Result<GetRunResult, RunReadError> {
    return ok({
      run: this.runStore.getRunForAutomation(input.automationId, input.runId),
    });
  }

  listRuns(input: ListRunsInput): Result<ListRunsResult, RunReadError> {
    return ok({
      runs: this.runStore.listRuns({
        automationId: input.automationId,
        status: input.status,
        before: input.before,
        limit: input.limit ?? LIST_RUNS_DEFAULT_LIMIT,
      }),
    });
  }

  listChangedRuns(input: ListChangedRunsInput): Result<ListChangedRunsResult, RunReadError> {
    const limit = input.limit ?? LIST_CHANGED_RUNS_DEFAULT_LIMIT;
    const runs = this.runStore.listChangedRuns({
      sinceSeq: input.sinceSeq,
      automationId: input.automationId,
      limit,
    });
    const nextSeq = runs.length > 0 ? runs[runs.length - 1].seq : input.sinceSeq;
    return ok({ runs, nextSeq });
  }

  getRunOverview(input: GetRunOverviewInput): Result<GetRunOverviewResult, RunReadError> {
    const counts = Object.fromEntries(
      automationRunStatuses.map((status) => [status, 0])
    ) as GetRunOverviewResult['counts'];
    Object.assign(counts, this.runStore.countRunsByStatus(input.automationId));
    return ok({
      counts,
      latestRun: this.runStore.getLatestRun(input.automationId),
      nextScheduledRun: this.runStore.getNextScheduledRun(input.automationId),
    });
  }

  private emitRunEvent(run: AutomationRun): void {
    if (this.allRunEventsActive) this.runEventsHost.emit({}, { run });
    if (this.activeAutomationIds.has(run.automationId)) {
      this.runEventsHost.emit({ automationId: run.automationId }, { run });
    }
  }
}
