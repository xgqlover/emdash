import { formatHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeHostUnavailable,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import type { Scope } from '@emdash/shared/concurrency';
// [XG-CUSTOM 2026-11-05] oxfmt(sortImports) 把这一行从 @emdash/wire/rpc 之后归位到 shared 组；
// 本文件新增的看门狗判定（channelStalled）用的就是它，所以顺手记一笔，避免以为是上游改动。
import { log as ambientLog } from '@emdash/shared/logger';
import {
  retrySchedule,
  runWithTimeout,
  systemClock,
  waitWithSignal,
  type Clock,
  type TimerHandle,
  type RetrySchedule,
} from '@emdash/shared/scheduling';
import type { WireTransport } from '@emdash/wire/rpc';
import { cell, derived, peek, snapshot, type Readable } from '@emdash/wire/state';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type { HostAvailabilityState, HostPreparingPhase } from '../api/availability';
import type { WorkspaceServerTarget } from '../api/targets';
// [XG-CUSTOM 2026-11-05] 通道停滞看门狗：阈值默认值 + 判定结果类型（见 channel-stall-watchdog.ts）。
import { DEFAULT_WIRE_STALL_MS, type ChannelStallFinding } from './channel-stall-watchdog';
import { HostRuntimeConnection } from './host-runtime-connection';
import type { HostServerOperationOwner } from './remote-host-workspace-server';
import { translateHostPreparationError } from './runtime-resolution';
import type { WorkspaceServerConnection } from './workspace-server/connect/wire-connection-manager';

export type SupervisorWakeCause = 'online' | 'focus' | 'resume' | 'rpc-timeout' | 'retry' | 'timer';
export type HostConnectionState =
  | { kind: 'idle' | 'stopped' }
  | { kind: 'paused'; reason: 'operation' | 'stopped' | 'failed'; issue?: RuntimeResolveError }
  | {
      kind: 'connecting' | 'recovering';
      phase: HostPreparingPhase;
      attempt: number;
      issue?: RuntimeResolveError;
      nextAttemptAt?: number;
    }
  | { kind: 'checking'; generation: number }
  | { kind: 'ready'; generation: number }
  | { kind: 'blocked'; layer: 'ssh' | 'runtime'; issue: RuntimeResolveError };

export type HostConnectionSupervisorOptions = {
  scope: Scope;
  nextGeneration?(): number;
  host: HostRef;
  intent: {
    enabled(): boolean | undefined;
    runtimeWanted(): boolean;
    restore(): Promise<void>;
    maintainRuntime(): void;
  };
  ssh: {
    connected(): boolean;
    establish(signal: AbortSignal): Promise<void>;
    reset(): void;
    probe(signal: AbortSignal): Promise<void>;
  };
  runtime: {
    prepare(signal: AbortSignal): Promise<WorkspaceServerTarget>;
    open(target: WorkspaceServerTarget, signal: AbortSignal): Promise<WireTransport>;
    cancel(): void;
  };
  clock?: Clock;
  random?: () => number;
  retrySchedule?: RetrySchedule;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  openTimeoutMs?: number;
  initializeTimeoutMs?: number;
  preparationTimeoutMs?: number;
  /** [XG-CUSTOM 2026-11-05] 通道停滞阈值/节拍（缺省 15 s / 1 s；`XG_WIRE_STALL_MS` 覆盖阈值）。 */
  stallMs?: number;
  stallTickMs?: number;
  client?: { id: string; appVersion: string };
  onReady?(attachment: WorkspaceServerConnection): void;
  log?(state: HostConnectionState, detail: Record<string, unknown>): void;
};

type Waiter = { kind: 'ssh' | 'runtime'; resolve(): void; reject(error: unknown): void };

/** One lifecycle owner; physical adapters never schedule another recovery loop. */
export class HostConnectionSupervisor {
  private readonly stateCell = cell<HostConnectionState>({ kind: 'idle' });
  readonly state: Readable<HostConnectionState> = this.stateCell;
  // This total projection always has a value; unlike async queries it cannot be loading.
  readonly availability = derived(() =>
    projectAvailability(snapshot(this.state).value)
  ) as Readable<HostAvailabilityState>;
  readonly attachment: WorkspaceServerConnection;
  private readonly scope: Scope;
  private readonly clock: Clock;
  private operations: Scope;
  private readonly runtimeConnection: HostRuntimeConnection;
  private readonly waiters = new Set<Waiter>();
  private runtimePolicy:
    | { kind: 'active' }
    | { kind: 'paused'; reason: 'operation' | 'stopped' | 'failed'; issue?: RuntimeResolveError }
    | { kind: 'blocked'; issue: RuntimeResolveError } = { kind: 'active' };
  private readonly retrySchedule: RetrySchedule;
  private lastCause = 'startup';
  private target: WorkspaceServerTarget | undefined;
  private generation = 0;
  private epoch = 0;
  private active: Scope | undefined;
  private timer: TimerHandle | undefined;
  private lastValidatedAt = 0;
  private lastFocusAt = -Infinity;
  private lastOnlineAt = -Infinity;
  private systemSuspended = false;
  private resettingSsh = false;
  // [XG-CUSTOM 2026-11-05] 停滞阈值（毫秒），由 options 或 XG_WIRE_STALL_MS 决定。
  private readonly stallMs: number;

  constructor(private readonly options: HostConnectionSupervisorOptions) {
    this.scope = options.scope.child('host-connection');
    this.operations = this.scope.child('server-operations');
    this.clock = options.clock ?? systemClock;
    // [XG-CUSTOM 2026-11-05] 停滞阈值：默认 15 s；`XG_WIRE_STALL_MS` 可覆盖（非法值回退默认）。
    this.stallMs = options.stallMs ?? resolveWireStallMs();
    this.retrySchedule =
      options.retrySchedule ??
      retrySchedule({
        // [XG-CUSTOM 2026-11-02] Bounded auto-reconnect, no manual Retry needed.
        // Fast burst = 1 s / 2 s / 4 s / 8 s / 16 s (5 retries, 31 s window), then
        // the pre-existing 30 s steady cadence via `repeatLast`. The burst is what
        // "Reconnect on its own"; the steady tail keeps a long outage healing
        // without the unbounded tight spinning that made the panel flap.
        delaysMs: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000],
        repeatLast: true,
        jitter: { random: options.random },
      });
    this.runtimeConnection = new HostRuntimeConnection({
      scope: this.scope,
      clock: this.clock,
      open: (target, signal) => options.runtime.open(target, signal),
      openTimeoutMs: options.openTimeoutMs ?? 10_000,
      initializeTimeoutMs: options.initializeTimeoutMs ?? 10_000,
      healthTimeoutMs: options.healthTimeoutMs ?? 5_000,
      client: options.client,
      onRequestTimeout: () => this.revalidate('rpc-timeout'),
      // [XG-CUSTOM 2026-11-05] 通道停滞 ⇒ 走下面 channelStalled 的既有「断开 + 重建」路径。
      onChannelStall: (finding) => this.channelStalled(finding),
      stallMs: this.stallMs,
      stallTickMs: options.stallTickMs,
      onDisconnect: () => {
        if (
          this.scope.disposed ||
          this.options.intent.enabled() !== true ||
          this.systemSuspended ||
          !this.runtimeWanted
        )
          return;
        void this.timer?.dispose();
        this.timer = undefined;
        this.publish({ kind: 'recovering', phase: 'handshaking', attempt: 1 });
        if (!this.active) this.start();
      },
    });
    const target = () => {
      if (!this.target) throw new Error('Host attachment is not initialized');
      return this.target;
    };
    this.attachment = {
      get target() {
        return target();
      },
      connection: this.runtimeConnection.connection,
      client: this.runtimeConnection.client,
      ready: async () => {
        await this.awaitUsable();
        const handshake = this.runtimeConnection.currentHandshake;
        if (!handshake) throw new Error('Host handshake is unavailable');
        return handshake;
      },
      currentHandshake: () => this.runtimeConnection.currentHandshake,
    };
    this.scope.signal.addEventListener(
      'abort',
      () => {
        this.cancel();
        this.options.runtime.cancel();
        this.resetSsh();
        void this.runtimeConnection.dispose();
        this.publish({ kind: 'idle' });
        this.rejectWaiters(this.runtimeUnavailable('Host identity disposed'));
      },
      { once: true }
    );
  }

  private get sshBlocked(): boolean {
    const state = peek(this.state);
    return state.kind === 'blocked' && state.layer === 'ssh';
  }

  private get runtimePaused(): boolean {
    return this.runtimePolicy.kind === 'paused';
  }

  private get runtimeBlock(): RuntimeResolveError | undefined {
    return this.runtimePolicy.kind === 'blocked' ? this.runtimePolicy.issue : undefined;
  }

  private get runtimeWanted(): boolean {
    return !this.runtimePaused && this.options.intent.runtimeWanted();
  }

  releaseRuntime(): void {
    if (this.scope.disposed || this.runtimeWanted || this.runtimePaused) return;
    this.cancel();
    this.runtimeConnection.detach();
    this.rejectWaiters(this.runtimeUnavailable('Runtime demand released'), 'runtime');
    // Lease ownership never clears an actionable block or disconnected intent.
    if (this.options.intent.enabled() && peek(this.state).kind !== 'blocked') {
      this.publish({ kind: 'idle' });
      this.start();
    }
  }

  private runtimeUnavailable(message: string): RuntimeResolveError {
    return runtimeHostUnavailable(this.options.host, 'runtime-unavailable', message);
  }

  restoreIntent(): void {
    if (this.scope.disposed) return;
    if (this.options.intent.enabled() === false) this.publish({ kind: 'stopped' });
    else if (this.options.intent.enabled()) this.start();
  }

  intentFailed(error: unknown): void {
    this.publish({
      kind: 'blocked',
      layer: 'ssh',
      issue: translateHostPreparationError(this.options.host, 'connecting', error),
    });
  }

  assertCanConnect(runtime: boolean): void {
    if (this.scope.disposed) throw this.runtimeUnavailable('Host identity disposed');
    if (
      runtime &&
      this.runtimePolicy.kind === 'paused' &&
      this.runtimePolicy.reason === 'operation'
    ) {
      throw this.runtimeUnavailable('A workspace server operation is in progress');
    }
  }

  activate(runtime: boolean): void {
    this.lastCause = 'connect';
    if (this.operations.disposed) this.operations = this.scope.child('server-operations');
    if (runtime) {
      this.runtimePolicy = { kind: 'active' };
    }
    if (this.sshBlocked || peek(this.state).kind === 'stopped') {
      this.publish({ kind: 'idle' });
    }
    if (runtime && (peek(this.state).kind === 'ready' || peek(this.state).kind === 'recovering'))
      this.revalidate('retry');
    else this.start();
  }

  async ensureSsh(signal?: AbortSignal): Promise<void> {
    await (signal
      ? waitWithSignal(this.options.intent.restore(), signal)
      : this.options.intent.restore());
    await this.wait('ssh', signal);
  }

  getAttachment(): WorkspaceServerConnection {
    return this.attachment;
  }

  async awaitUsable(signal?: AbortSignal): Promise<number> {
    if (this.runtimePaused) throw this.runtimeUnavailable('Workspace server is stopped');
    if (!this.runtimeWanted)
      throw this.runtimeUnavailable('Host runtime requires an active demand');
    await (signal
      ? waitWithSignal(this.options.intent.restore(), signal)
      : this.options.intent.restore());
    await this.wait('runtime', signal);
    return this.generation;
  }

  revalidate(cause: SupervisorWakeCause): void {
    if (this.scope.disposed || this.systemSuspended || this.options.intent.enabled() !== true)
      return;
    const state = peek(this.state);
    this.lastCause = cause;
    if (this.sshBlocked && cause !== 'retry') return;
    if (cause === 'focus') {
      if (this.clock.now() - this.lastFocusAt < 30_000) return;
      this.lastFocusAt = this.clock.now();
    }
    if (cause === 'online') {
      if (this.clock.now() - this.lastOnlineAt < 30_000) return;
      this.lastOnlineAt = this.clock.now();
    }
    if (cause === 'retry' && state.kind === 'blocked') {
      this.runtimePolicy = { kind: 'active' };
      this.publish({ kind: 'idle' });
    }
    // Routine hints do not revoke recent health evidence. Keep the same ready
    // snapshot and allow live input until the probe establishes a failure.
    const keepReady =
      state.kind === 'ready' &&
      this.runtimeConnection.connected &&
      this.hasFreshHealth() &&
      (cause === 'focus' || cause === 'online' || cause === 'timer');
    if (this.active) {
      // A timeout or expired evidence must still demote an in-flight quiet probe.
      if (state.kind === 'ready' && !keepReady && !this.runtimeBlock)
        this.publish({ kind: 'checking', generation: this.generation });
      if (
        (cause !== 'retry' && cause !== 'online') ||
        state.kind !== 'recovering' ||
        state.nextAttemptAt === undefined
      )
        return;
      this.cancel();
    }
    void this.timer?.dispose();
    this.timer = undefined;
    if (
      !this.runtimeConnection.connected &&
      ((this.runtimeWanted && !this.runtimeBlock) || !this.options.ssh.connected())
    ) {
      this.start();
      return;
    }
    const wireProbe = this.runtimeConnection.connected;
    const attemptScope = this.scope.child('connection-attempt');
    this.active = attemptScope;
    if (!keepReady && !this.runtimeBlock)
      this.publish({ kind: 'checking', generation: this.generation });
    const epoch = this.epoch;
    void attemptScope
      .run('validate', async () => {
        // Validate SSH alongside the retained Wire channel. A sleeping laptop can leave
        // both objects apparently connected; serial deadlines needlessly delay recovery.
        const sshHealthy = wireProbe
          ? runWithTimeout((signal) => this.options.ssh.probe(signal), {
              signal: attemptScope.signal,
              clock: this.clock,
              timeoutMs: this.options.healthTimeoutMs ?? 5_000,
            }).then(
              () => true,
              () => false
            )
          : undefined;
        const validation = wireProbe
          ? this.runtimeConnection.probe(attemptScope.signal)
          : runWithTimeout((signal) => this.options.ssh.probe(signal), {
              signal: attemptScope.signal,
              clock: this.clock,
              timeoutMs: this.options.healthTimeoutMs ?? 5_000,
            });
        await validation.then(
          () => {
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.lastValidatedAt = this.clock.now();
            if (!wireProbe || peek(this.state).kind !== 'ready')
              this.publish(
                wireProbe
                  ? { kind: 'ready', generation: this.generation }
                  : this.runtimeBlock
                    ? { kind: 'blocked', layer: 'runtime', issue: this.runtimeBlock }
                    : { kind: 'idle' }
              );
            this.resolveWaiters();
          },
          async () => {
            const resetPhysical = !wireProbe || (await sshHealthy) === false;
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.publish({ kind: 'recovering', phase: 'handshaking', attempt: 1 });
            this.runtimeConnection.detach();
            if (resetPhysical) this.resetSsh();
          }
        );
      })
      .exit.then(() => this.finishAttempt(attemptScope, epoch));
  }

  sshDisconnected(): void {
    if (
      this.resettingSsh ||
      this.scope.disposed ||
      !this.options.intent.enabled() ||
      this.sshBlocked
    )
      return;
    this.runtimeConnection.detach();
    this.publish({ kind: 'recovering', phase: 'connecting', attempt: 1 });
    if (!this.active) this.start();
  }

  /**
   * [XG-CUSTOM 2026-11-05] 通道停滞：走**既有**的「断开 + 重建」路径
   * （cancel + resetSsh + detach + start），不新写一条连接建立逻辑。
   *
   * 为什么必须连带 resetSsh：这种坏通道 SSH 自报 `isConnected`、`onDisconnect` 一次都不触发，
   * 只 `detach()` wire 会在**同一条卡死的 TCP** 上重开通道 ⇒ 1.2.63 的有界自动重连因此空转
   * （服务端 Send-Q 从 675 KB 涨到 714 KB 一直回不去）。reset 会走到 `client.destroy()`，
   * 把积压和那条死 socket 一起丢掉，下次 recover() 才是真的新连接。
   */
  private channelStalled(finding: ChannelStallFinding): void {
    if (this.scope.disposed || this.systemSuspended) return;
    if (this.options.intent.enabled() !== true) return;
    if (this.runtimePolicy.kind === 'paused') return;
    // 已经在重建中：让那次重建走完，不叠第二次（防抖第二道闸；第一道在 watchdog 的 armed）。
    if (this.active) return;
    // [XG-CUSTOM 2026-11-05] 结构化日志：{wstag:"stall-detect", pending, idleMs, stallMs, attempt}。
    ambientLog.warn('wire channel stalled; rebuilding host connection', {
      wstag: 'stall-detect',
      host: formatHostRef(this.options.host),
      pending: finding.pending,
      idleMs: finding.idleMs,
      stallMs: finding.stallMs,
      attempt: finding.attempt,
    });
    this.lastCause = 'stall';
    this.cancel();
    this.publish({ kind: 'recovering', phase: 'connecting', attempt: finding.attempt });
    this.resetSsh();
    this.runtimeConnection.detach();
    this.start();
  }

  suspendSystem(): void {
    if (this.scope.disposed) return;
    this.systemSuspended = true;
    const pending = this.active !== undefined;
    this.cancel();
    if (pending && !this.runtimeConnection.connected) this.resetSsh();
    if (this.options.intent.enabled() && peek(this.state).kind !== 'blocked')
      this.publish({ kind: 'checking', generation: this.generation });
  }

  resume(): void {
    if (this.scope.disposed) return;
    this.systemSuspended = false;
    // Resume may arrive without suspend (or after the event loop was paused).
    this.cancel();
    if (this.runtimeWanted && !this.runtimeBlock && !this.runtimeConnection.connected)
      this.resetSsh();
    this.revalidate('resume');
  }

  stop(): void {
    if (this.scope.disposed) throw this.runtimeUnavailable('Host identity disposed');
    void this.operations.dispose(new Error('Host was disconnected'));
    this.cancel();
    this.publish({ kind: 'stopped' });
    this.rejectWaiters(new Error('Host was disconnected'));
    this.options.runtime.cancel();
    this.runtimeConnection.detach();
    this.resetSsh();
  }

  /** Cancels runtime recovery for an explicit server lifecycle operation. */
  pauseRuntime(
    issue?: RuntimeResolveError,
    reason: 'operation' | 'stopped' | 'failed' = 'stopped'
  ): void {
    this.cancel();
    this.runtimePolicy = { kind: 'paused', reason, issue };
    this.rejectWaiters(this.runtimeUnavailable('Workspace server is stopped'), 'runtime');
    this.target = undefined;
    this.runtimeConnection.detach();
    this.publish({ kind: 'idle' });
    this.start();
  }

  resumeRuntime(): void {
    this.runtimePolicy = { kind: 'active' };
    this.options.intent.maintainRuntime();
    this.revalidate('retry');
  }

  serverOperationOwner(): HostServerOperationOwner {
    const scope = this.operations;
    let paused = false;
    return {
      scope,
      before: async (action, signal) => {
        await this.ensureSsh(signal);
        signal.throwIfAborted();
        if (!action.startsWith('refresh')) {
          this.pauseRuntime(undefined, 'operation');
          paused = true;
        }
      },
      settled: (action, result) => {
        if (!paused || scope.disposed || this.scope.disposed || this.operations !== scope) return;
        if (result.success) {
          if (action !== 'stop') this.resumeRuntime();
          else this.pauseRuntime();
        } else {
          this.pauseRuntime(
            translateHostPreparationError(this.options.host, 'provisioning', result.error),
            'failed'
          );
        }
      },
    };
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
  }

  private start(): void {
    if (
      this.active ||
      this.scope.disposed ||
      this.systemSuspended ||
      !this.options.intent.enabled()
    )
      return;
    if (this.sshBlocked) return;
    if (
      this.options.ssh.connected() &&
      (!this.runtimeWanted || this.runtimeConnection.connected || this.runtimeBlock)
    ) {
      this.resolveWaiters();
      this.scheduleHealth();
      return;
    }
    void this.timer?.dispose();
    this.timer = undefined;
    const attemptScope = this.scope.child('connection-attempt');
    this.active = attemptScope;
    const epoch = this.epoch;
    void attemptScope
      .run('recover', () => this.recover(attemptScope, epoch))
      .exit.then(() => this.finishAttempt(attemptScope, epoch));
  }

  private finishAttempt(attempt: Scope, epoch: number): void {
    const current = this.isCurrent(attempt, epoch);
    void attempt.dispose();
    if (!current) return;
    this.active = undefined;
    if (
      this.runtimeConnection.connected ||
      ((!this.runtimeWanted || this.runtimeBlock) && this.options.ssh.connected())
    ) {
      this.scheduleHealth();
    } else if (peek(this.state).kind === 'recovering') {
      // A disconnect may arrive after readiness settles but before this run exits.
      this.start();
    }
  }

  private async recover(attemptScope: Scope, epoch: number): Promise<void> {
    const signal = attemptScope.signal;
    let attempt = 0;
    while (this.isCurrent(attemptScope, epoch)) {
      attempt += 1;
      let phase: HostPreparingPhase = 'connecting';
      const progress = (next: HostPreparingPhase) => {
        phase = next;
        this.publish({ kind: this.generation ? 'recovering' : 'connecting', phase, attempt });
      };
      try {
        progress('connecting');
        await waitWithSignal(this.options.ssh.establish(signal), signal);
        if (!this.isCurrent(attemptScope, epoch)) return;
        this.lastValidatedAt = this.clock.now();
        this.resolveWaiters();
        if (this.runtimeBlock) {
          this.publish({ kind: 'blocked', layer: 'runtime', issue: this.runtimeBlock });
          return;
        }
        if (!this.runtimeWanted) {
          this.publish({ kind: 'idle' });
          return;
        }
        progress('provisioning');
        const target =
          this.target ??
          (await runWithTimeout((inner) => this.options.runtime.prepare(inner), {
            signal,
            clock: this.clock,
            timeoutMs: this.options.preparationTimeoutMs ?? 120_000,
          }));
        if (!this.isCurrent(attemptScope, epoch)) return;
        this.target = target;
        progress('handshaking');
        await this.runtimeConnection.establish(target, signal);
        if (!this.isCurrent(attemptScope, epoch)) return;
        // A disconnect can arrive between installation and this continuation.
        if (!this.runtimeConnection.connected)
          throw new Error('Host disconnected during initialization');
        const installedGeneration = this.runtimeConnection.generation;
        try {
          this.generation = this.options.nextGeneration?.() ?? this.generation + 1;
          this.lastValidatedAt = this.clock.now();
          this.publish({ kind: 'ready', generation: this.generation });
          // [XG-CUSTOM 2026-11-02] The episode counter is `attempt` above and is
          // reset by starting a new `recover()` run; log the recovery so the
          // operator can see the retry ladder converge instead of a silent flap.
          if (attempt > 1) {
            ambientLog.info('host reconnected after retries', {
              host: formatHostRef(this.options.host),
              attempt,
            });
          }
          this.options.onReady?.(this.attachment);
          this.resolveWaiters();
          return;
        } catch (error) {
          this.runtimeConnection.detach(installedGeneration);
          throw error;
        }
      } catch (error) {
        if (!this.isCurrent(attemptScope, epoch)) return;
        const issue = translateHostPreparationError(this.options.host, phase, error);
        if (isBlocked(error, issue)) {
          if (phase !== 'connecting') this.runtimePolicy = { kind: 'blocked', issue };
          this.publish({
            kind: 'blocked',
            layer: phase === 'connecting' ? 'ssh' : 'runtime',
            issue,
          });
          this.rejectWaiters(issue);
          return;
        }
        if (phase !== 'connecting' && this.options.ssh.connected()) {
          try {
            await runWithTimeout((inner) => this.options.ssh.probe(inner), {
              signal,
              clock: this.clock,
              timeoutMs: this.options.healthTimeoutMs ?? 5_000,
            });
          } catch {
            if (!this.isCurrent(attemptScope, epoch)) return;
            this.resetSsh();
          }
        }
        if (!this.isCurrent(attemptScope, epoch)) return;
        const delay = this.retrySchedule.delayFor(attempt - 1);
        if (delay === undefined) {
          ambientLog.error('host reconnect gave up; manual retry required', {
            host: formatHostRef(this.options.host),
            attempt,
          });
          this.runtimePolicy = { kind: 'paused', reason: 'failed', issue };
          this.publish({ kind: 'paused', reason: 'failed', issue });
          this.rejectWaiters(issue);
          return;
        }
        this.publish({
          kind: 'recovering',
          phase,
          attempt,
          issue,
          nextAttemptAt: this.clock.now() + delay,
        });
        // [XG-CUSTOM 2026-11-02] Every retry carries its attempt number and the
        // delay it is about to wait, so the backoff ladder is auditable in the log.
        ambientLog.warn('host reconnect attempt failed, retrying', {
          host: formatHostRef(this.options.host),
          attempt,
          phase,
          delayMs: delay,
          reason: issue.type === 'host-unavailable' ? issue.reason : issue.type,
        });
        try {
          await this.clock.sleep(delay, { signal, unref: true });
        } catch {
          return;
        }
      }
    }
  }

  private hasFreshHealth(): boolean {
    return (
      this.clock.now() - this.lastValidatedAt <=
      (this.options.healthIntervalMs ?? 15_000) + (this.options.healthTimeoutMs ?? 5_000)
    );
  }

  private scheduleHealth(): void {
    if (
      this.timer?.active ||
      !this.options.intent.enabled() ||
      this.systemSuspended ||
      this.scope.disposed
    )
      return;
    const interval = this.options.healthIntervalMs ?? 15_000;
    this.timer = this.clock.schedule(
      interval,
      () => {
        this.timer = undefined;
        if (!this.hasFreshHealth()) {
          this.resume();
        } else this.revalidate('timer');
      },
      { unref: true }
    );
  }

  private wait(kind: Waiter['kind'], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.scope.disposed || !this.options.intent.enabled())
      return Promise.reject(new Error('Host is disconnected'));
    const state = peek(this.state);
    if (kind === 'runtime' && (this.runtimePaused || !this.runtimeWanted)) {
      return Promise.reject(this.runtimeUnavailable('Host runtime is not being maintained'));
    }
    if (this.usable(kind)) return Promise.resolve();
    if (state.kind === 'blocked' && (kind === 'runtime' || state.layer === 'ssh'))
      return Promise.reject(state.issue);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(waiter);
        signal?.removeEventListener('abort', abort);
      };
      const waiter: Waiter = {
        kind,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const abort = () => waiter.reject(signal?.reason);
      this.waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private usable(kind: Waiter['kind']): boolean {
    return (
      !this.systemSuspended &&
      (kind === 'ssh'
        ? this.options.ssh.connected()
        : peek(this.state).kind === 'ready' && this.runtimeConnection.connected)
    );
  }
  private resolveWaiters(): void {
    for (const waiter of this.waiters) if (this.usable(waiter.kind)) waiter.resolve();
  }
  private rejectWaiters(error: unknown, kind?: Waiter['kind']): void {
    for (const waiter of this.waiters) if (!kind || waiter.kind === kind) waiter.reject(error);
  }
  private resetSsh(): void {
    this.resettingSsh = true;
    try {
      this.options.ssh.reset();
    } finally {
      this.resettingSsh = false;
    }
  }
  private cancel(): void {
    this.epoch += 1;
    const active = this.active;
    this.active = undefined;
    void active?.dispose(new Error('Host connection attempt superseded'));
    if (active) this.options.runtime.cancel();
    void this.timer?.dispose();
    this.timer = undefined;
  }
  private isCurrent(attemptScope: Scope, epoch: number): boolean {
    return (
      this.active === attemptScope &&
      this.epoch === epoch &&
      !attemptScope.disposed &&
      !this.scope.disposed
    );
  }
  private publish(state: HostConnectionState): void {
    if (
      this.runtimePolicy.kind === 'paused' &&
      (state.kind === 'idle' || state.kind === 'checking' || state.kind === 'ready')
    ) {
      state = {
        kind: 'paused',
        reason: this.runtimePolicy.reason,
        issue: this.runtimePolicy.issue,
      };
    }
    this.stateCell.set(state);
    this.options.log?.(state, {
      host: this.options.host,
      cause: this.lastCause,
      epoch: this.epoch,
      wireGeneration: this.runtimeConnection.generation,
      lastValidatedAt: this.lastValidatedAt,
    });
  }
}

/**
 * [XG-CUSTOM 2026-11-05] `XG_WIRE_STALL_MS` 覆盖停滞阈值（毫秒）。
 * 非法值不静默改语义：打一条 warn 再回退默认 15 s。
 */
function resolveWireStallMs(): number {
  if (typeof process === 'undefined') return DEFAULT_WIRE_STALL_MS;
  const raw = process.env.XG_WIRE_STALL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_WIRE_STALL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ambientLog.warn('ignoring invalid XG_WIRE_STALL_MS', {
      value: raw,
      fallbackMs: DEFAULT_WIRE_STALL_MS,
    });
    return DEFAULT_WIRE_STALL_MS;
  }
  return Math.floor(parsed);
}

function isBlocked(error: unknown, issue: RuntimeResolveError): boolean {
  const visited = new Set<unknown>();
  for (
    let current = error;
    current instanceof Error && !visited.has(current);
    current = current.cause
  ) {
    visited.add(current);
    if (
      current instanceof SshConnectionFailure &&
      ['authentication', 'configuration', 'host-key'].includes(current.kind)
    )
      return true;
  }
  return (
    issue.type !== 'host-unavailable' ||
    !['offline', 'connection-failed', 'runtime-unavailable', 'daemon-start-failed'].includes(
      issue.reason
    )
  );
}

function projectAvailability(state: HostConnectionState): HostAvailabilityState {
  let availability: HostAvailabilityState;
  switch (state.kind) {
    case 'paused':
      availability =
        state.reason === 'operation'
          ? { kind: 'preparing', phase: 'provisioning', attempt: 1 }
          : { kind: 'unavailable', recovery: 'manual', issue: state.issue };
      break;
    case 'ready':
      availability = { kind: 'ready', generation: state.generation };
      break;
    case 'stopped':
      availability = { kind: 'suspended', reason: 'user-disconnected' };
      break;
    case 'idle':
      availability = { kind: 'unavailable', recovery: 'eligible' };
      break;
    case 'blocked':
      availability = { kind: 'unavailable', recovery: 'blocked', issue: state.issue };
      break;
    case 'checking':
      availability = { kind: 'preparing', phase: 'checking', attempt: 1 };
      break;
    default:
      availability =
        state.nextAttemptAt !== undefined
          ? {
              kind: 'unavailable',
              recovery: 'waiting',
              nextAttemptAt: state.nextAttemptAt,
              issue: state.issue,
            }
          : { kind: 'preparing', phase: state.phase, attempt: state.attempt };
  }
  return availability;
}
