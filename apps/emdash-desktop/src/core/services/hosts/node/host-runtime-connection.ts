import { workspaceWireContract, type WireInitializeResult } from '@emdash/core/workspace-server';
import type { Scope } from '@emdash/shared/concurrency';
import { runWithTimeout, waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import {
  client,
  connect,
  replaceableTransport,
  type Connection,
  type ContractClient,
  type WireTransport,
} from '@emdash/wire/rpc';
import type { WorkspaceServerTarget } from '../api/targets';
import {
  // [XG-CUSTOM 2026-11-05] 通道停滞看门狗（判据/防抖/结构化日志都在那个文件里）。
  createChannelStallWatchdog,
  type ChannelStallFinding,
  type ChannelStallWatchdog,
} from './channel-stall-watchdog';
import { initializeWorkspaceServerTransport } from './workspace-server/connect/protocol';

export type HostRuntimeConnectionOptions = {
  scope: Scope;
  clock: Clock;
  open(target: WorkspaceServerTarget, signal: AbortSignal): Promise<WireTransport>;
  openTimeoutMs: number;
  initializeTimeoutMs: number;
  healthTimeoutMs: number;
  client?: { id: string; appVersion: string };
  onDisconnect(): void;
  onRequestTimeout(): void;
  /**
   * [XG-CUSTOM 2026-11-05] 判定通道停滞 —— 调用方（supervisor）走既有的断开 + 重建路径。
   * 本类只负责「发现」，恢复策略仍归 supervisor 所有。
   */
  onChannelStall(finding: ChannelStallFinding): void;
  /** [XG-CUSTOM 2026-11-05] 停滞阈值 / 节拍（缺省 15 s / 1 s）。 */
  stallMs?: number;
  stallTickMs?: number;
};

/** Owns Wire resources and single attempts. Recovery policy belongs to the supervisor. */
export class HostRuntimeConnection {
  readonly connection: Connection;
  readonly client: ContractClient<typeof workspaceWireContract>;
  private readonly scope: Scope;
  private readonly transport = replaceableTransport();
  private handshake: WireInitializeResult | undefined;
  private opening: Scope | undefined;
  // [XG-CUSTOM 2026-11-05] 通道停滞看门狗（见 channel-stall-watchdog.ts）。
  private readonly stallWatchdog: ChannelStallWatchdog;

  constructor(private readonly options: HostRuntimeConnectionOptions) {
    this.scope = options.scope.child('host-runtime-connection');
    this.connection = connect(this.transport, {
      clock: options.clock,
      maxHeldCalls: 0,
      instrumentation: {
        callEnd: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') options.onRequestTimeout();
        },
        snapshot: ({ errorCode }) => {
          if (errorCode === 'TIMEOUT') options.onRequestTimeout();
        },
      },
    });
    this.client = client(workspaceWireContract, this.connection);
    // [XG-CUSTOM 2026-11-05] 通道停滞看门狗：入站帧是「通道还活着」的唯一证据。
    // 判据 = 有请求在等（Connection 里已有的 pending 表）却长时间没有任何入站帧。
    this.stallWatchdog = createChannelStallWatchdog({
      clock: options.clock,
      pending: () => this.connection.pendingCallCount(),
      // 握手中（还没装上物理通道）不判停滞：那是「还没连上」，不是「通道断了」。
      handshaking: () => !this.transport.connected || this.opening !== undefined,
      stallMs: options.stallMs,
      tickMs: options.stallTickMs,
      onStall: (finding) => options.onChannelStall(finding),
    });
    this.scope.add(() => this.stallWatchdog.dispose());
    // [XG-CUSTOM 2026-11-05] 入站打点：每个 wire 帧刷新 lastInboundAt 并解除防抖闸。
    this.scope.add(
      this.transport.onMessage(() => {
        this.stallWatchdog.noteInbound();
      })
    );
    // [XG-CUSTOM 2026-11-05] 新物理通道装上 ⇒ 重新计时（重建成功的第一个证据）。
    this.scope.add(
      this.transport.onReconnect(() => {
        this.stallWatchdog.noteConnected();
      })
    );
    this.stallWatchdog.start();
    this.scope.add(
      this.transport.onDisconnect(() => {
        if (!this.scope.disposed) options.onDisconnect();
      })
    );
    this.scope.signal.addEventListener('abort', () => this.transport.close(), { once: true });
    if (this.scope.signal.aborted) this.transport.close();
    this.scope.add(() => this.connection.dispose());
  }

  /** A transport is installed; this is not a claim of fresh responsiveness. */
  get connected(): boolean {
    return this.transport.connected;
  }

  /** Physical Wire generation for diagnostics and conditional detach, distinct from Host readiness. */
  get generation(): number {
    return this.transport.generation;
  }

  get currentHandshake(): WireInitializeResult | undefined {
    return this.connected ? this.handshake : undefined;
  }

  /** One bounded open + initialize + install. New attempts supersede unfinished ones. */
  async establish(target: WorkspaceServerTarget, callerSignal: AbortSignal): Promise<void> {
    this.scope.signal.throwIfAborted();
    callerSignal.throwIfAborted();
    void this.opening?.dispose(new Error('Runtime connection attempt superseded'));
    const opening = this.scope.child('establish');
    this.opening = opening;
    const signal = AbortSignal.any([callerSignal, opening.signal, this.scope.signal]);
    let candidate: WireTransport | undefined;
    let installed = false;
    try {
      const opened = await this.openCandidate(target, signal);
      candidate = opened;
      const handshake = await runWithTimeout(
        (inner) =>
          waitWithSignal(
            initializeWorkspaceServerTransport(opened, undefined, this.options.client),
            inner
          ),
        { signal, clock: this.options.clock, timeoutMs: this.options.initializeTimeoutMs }
      );
      signal.throwIfAborted();
      this.handshake = handshake;
      this.transport.install(candidate);
      if (!this.connected) throw new Error('Host disconnected during initialization');
      installed = true;
    } finally {
      if (!installed) candidate?.close?.();
      if (this.opening === opening) this.opening = undefined;
      await opening.dispose();
    }
  }

  /** Health evidence applies only to the physical transport that received the request. */
  async probe(callerSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([callerSignal, this.scope.signal]);
    signal.throwIfAborted();
    const physical = this.transport.current;
    const generation = this.transport.generation;
    if (!physical) throw new Error('Host attachment is unavailable');
    // Probe the physical transport directly: never queue or replay on its replacement.
    const connection = connect(physical, {
      clock: this.options.clock,
      callTimeoutMs: this.options.healthTimeoutMs,
    });
    try {
      await client(workspaceWireContract, connection).health(undefined, { signal });
      if (generation !== this.transport.generation) throw new Error('Superseded health response');
    } finally {
      connection.dispose();
    }
  }

  /** Release physical resources while retaining logical client/subscription identity. */
  detach(expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== this.generation) return;
    void this.opening?.dispose(new Error('Runtime connection detached'));
    this.transport.detach();
  }

  dispose(): Promise<void> {
    return this.scope.dispose();
  }

  private async openCandidate(
    target: WorkspaceServerTarget,
    signal: AbortSignal
  ): Promise<WireTransport> {
    let accepted = false;
    let pending: Promise<WireTransport> | undefined;
    try {
      const candidate = await runWithTimeout(
        (inner) => {
          pending = this.options.open(target, inner);
          return pending;
        },
        { signal, clock: this.options.clock, timeoutMs: this.options.openTimeoutMs }
      );
      accepted = true;
      return candidate;
    } finally {
      if (!accepted)
        void pending?.then(
          (late) => late.close?.(),
          () => {}
        );
    }
  }
}
