// [XG-CUSTOM 2026-10-05] **事件触发摄取端 ↔ 运行时**的端到端回归测试。
//
// 这是第 3 项第三片（把摄取端接进 runtime）的验收网：真起 runtime + **真发 HTTP**，
// 断言"外部可见的事实"—— 有没有监听、事件命中后**有没有真的多出一条 `triggerKind='webhook'` 的 run**、
// 过滤不匹配/坏 token 时**有没有误跑**、移除后**有没有把监听关掉**。
import { ok } from '@emdash/shared';
import { ManualClock } from '@emdash/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_HOST_REF } from '#primitives/host/api';
import type { TempStoreHandle } from '#primitives/sqlite-store/api';
import type { AutomationDeployment } from '../api/deployment';
import type { AutomationsDb } from './persistence/store';
import { automationsStore } from './persistence/store';
import type { AutomationSessionPort } from './ports/session-start';
import type { AutomationWorkspacePort } from './ports/workspace-provisioning';
import { AutomationsRuntime } from './runtime';
import { AUTOMATION_WEBHOOK_PATH_PREFIX, AUTOMATION_WEBHOOK_TOKEN_HEADER } from './webhook-server';

const START = Date.UTC(2026, 6, 16, 8, 59);
const MINUTE = 60_000;
const TOKEN = 'webhook-token-0123456789';

const worktree = {
  host: LOCAL_HOST_REF,
  path: { root: { kind: 'posix' as const }, segments: ['tmp', 'wt-1'] },
};

function webhookDeployment(overrides: Partial<AutomationDeployment> = {}): AutomationDeployment {
  return {
    automationId: 'auto-hook',
    enabled: true,
    name: 'On PR opened',
    // 事件触发的部署**没有 cron 计划**（schedule=null）—— 调度器见到它会跳过
    schedule: null,
    webhook: { token: TOKEN, filter: 'action == "opened"' },
    agent: {
      type: 'acp' as const,
      start: { providerId: 'claude', model: null, initialQueue: [{ text: 'Handle the event' }] },
    },
    workspace: {
      kind: 'worktree' as const,
      repository: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' as const }, segments: ['repo'] },
      },
      worktreePoolPath: {
        root: { kind: 'posix' as const },
        segments: ['worktrees', 'repo-12345678'],
      },
      baseRemote: 'origin',
      preservePatterns: ['.env*'],
      git: {
        kind: 'create-branch' as const,
        fromBranch: { type: 'local' as const, branch: 'main' },
        pushRemote: null,
      },
    },
    revision: 1,
    ...overrides,
  };
}

function cronDeployment(overrides: Partial<AutomationDeployment> = {}): AutomationDeployment {
  return {
    ...webhookDeployment(),
    automationId: 'auto-cron',
    schedule: { expr: '0 9 * * *', tz: 'UTC' },
    webhook: undefined,
    ...overrides,
  };
}

function fakeWorkspacePort(): AutomationWorkspacePort {
  return {
    provision: vi.fn(() => Promise.resolve(ok({ workspace: worktree, branchName: 'emdash-abc' }))),
  };
}

function fakeSessionPort(): AutomationSessionPort {
  return { start: vi.fn(() => Promise.resolve(ok({ sessionId: 'sess-1' }))) };
}

async function postEvent(
  port: number,
  automationId: string,
  options: { token?: string; body?: string } = {}
): Promise<number> {
  const response = await fetch(
    `http://127.0.0.1:${String(port)}${AUTOMATION_WEBHOOK_PATH_PREFIX}${automationId}`,
    {
      method: 'POST',
      headers:
        options.token === undefined ? {} : { [AUTOMATION_WEBHOOK_TOKEN_HEADER]: options.token },
      body: options.body ?? '{"action":"opened"}',
    }
  );
  return response.status;
}

describe('事件触发摄取端 ↔ AutomationsRuntime', () => {
  let handle: TempStoreHandle<AutomationsDb>;
  let runtime: AutomationsRuntime;

  function runsOf(automationId: string) {
    const result = runtime.listChangedRuns({ sinceSeq: 0, automationId });
    if (!result.success) throw new Error('listChangedRuns failed');
    return result.data.runs;
  }

  beforeEach(async () => {
    handle = await automationsStore.openTemp();
    runtime = new AutomationsRuntime({
      handle,
      workspacePort: fakeWorkspacePort(),
      sessionPort: fakeSessionPort(),
      clock: new ManualClock(START),
      tickIntervalMs: MINUTE,
      webhookPort: 0, // 测试让系统分配端口，避免占用 7823
    });
    runtime.start();
  });

  afterEach(async () => {
    await runtime.dispose();
    handle.close();
  });

  it('没有任何 webhook 部署 → 不起监听（不白占端口）', () => {
    expect(runtime.webhookListeningPort).toBe(0);
  });

  it('只有 cron 部署 → 同样不起监听', async () => {
    expect((await runtime.deploy(cronDeployment())).success).toBe(true);
    expect(runtime.webhookListeningPort).toBe(0);
  });

  it('部署 webhook 触发 → 监听起来 + 事件命中 → 多出一条 triggerKind=webhook 的 run', async () => {
    const deployed = await runtime.deploy(webhookDeployment());
    expect(deployed.success).toBe(true);
    const port = runtime.webhookListeningPort;
    expect(port).toBeGreaterThan(0);
    expect(runsOf('auto-hook')).toHaveLength(0); // 事件触发不会自己排计划

    const status = await postEvent(port, 'auto-hook', { token: TOKEN });
    expect(status).toBe(202);
    const runs = runsOf('auto-hook');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ automationId: 'auto-hook', triggerKind: 'webhook' });
  });

  it('配了 promptTemplate → 事件载荷被渲染进 run 的 prompt（快照里可见）', async () => {
    await runtime.deploy(
      webhookDeployment({
        webhook: { token: TOKEN, promptTemplate: '处理事件：\n{{payload}}' },
      })
    );
    const port = runtime.webhookListeningPort;
    expect(await postEvent(port, 'auto-hook', { token: TOKEN, body: '{"action":"opened"}' })).toBe(202);
    const runs = runsOf('auto-hook');
    expect(runs).toHaveLength(1);
    const snapshot = runs[0]!.configSnapshot as { agent?: { start?: { initialQueue?: { text?: string }[] } } };
    const prompt = snapshot.agent?.start?.initialQueue?.[0]?.text ?? '';
    expect(prompt).toContain('处理事件：');
    expect(prompt).toContain('"action": "opened"');
    expect(prompt).not.toContain('{{payload}}');
  });

  it('没配 promptTemplate → prompt 保持部署自带的原文（零行为变化）', async () => {
    await runtime.deploy(webhookDeployment());
    await postEvent(runtime.webhookListeningPort, 'auto-hook', { token: TOKEN });
    const snapshot = runsOf('auto-hook')[0]!.configSnapshot as { agent?: { start?: { initialQueue?: { text?: string }[] } } };
    expect(snapshot.agent?.start?.initialQueue?.[0]?.text).toBe('Handle the event');
  });

  it('过滤不匹配 → 204 且**不产生 run**', async () => {
    const port = (await runtime.deploy(webhookDeployment()), runtime.webhookListeningPort);
    expect(await postEvent(port, 'auto-hook', { token: TOKEN, body: '{"action":"closed"}' })).toBe(
      204
    );
    expect(runsOf('auto-hook')).toHaveLength(0);
  });

  it('坏 token → 403 且不产生 run', async () => {
    await runtime.deploy(webhookDeployment());
    const port = runtime.webhookListeningPort;
    expect(await postEvent(port, 'auto-hook', { token: 'wrong-token-000000' })).toBe(403);
    expect(await postEvent(port, 'auto-hook')).toBe(401);
    expect(runsOf('auto-hook')).toHaveLength(0);
  });

  it('非法过滤表达式 → 部署被拒（不给"看起来能跑其实永远不触发"的配置）', async () => {
    const result = await runtime.deploy(
      webhookDeployment({ webhook: { token: TOKEN, filter: 'action ==' } })
    );
    expect(result.success).toBe(false);
    expect(runtime.webhookListeningPort).toBe(0);
  });

  it('移除部署 → 监听关掉（连不上）', async () => {
    await runtime.deploy(webhookDeployment());
    const port = runtime.webhookListeningPort;
    expect(port).toBeGreaterThan(0);

    const removed = await runtime.remove({ automationId: 'auto-hook' });
    expect(removed.success).toBe(true);
    expect(runtime.webhookListeningPort).toBe(0);
    await expect(postEvent(port, 'auto-hook', { token: TOKEN })).rejects.toBeTruthy();
  });

  it('禁用（enabled=false）后监听直接关掉 —— 比"回 403"更彻底', async () => {
    await runtime.deploy(webhookDeployment());
    const port = runtime.webhookListeningPort;
    expect(port).toBeGreaterThan(0);

    await runtime.deploy(webhookDeployment({ enabled: false, revision: 2 }));
    // 目标列表只含**已启用**的部署 → 没有目标就不监听（端口释放、连不上）
    expect(runtime.webhookListeningPort).toBe(0);
    await expect(postEvent(port, 'auto-hook', { token: TOKEN })).rejects.toBeTruthy();
    expect(runsOf('auto-hook')).toHaveLength(0);
  });
});
