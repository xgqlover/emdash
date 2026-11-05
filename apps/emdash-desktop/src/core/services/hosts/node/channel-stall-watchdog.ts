import type { Clock, TimerHandle } from '@emdash/shared/scheduling';

/**
 * [XG-CUSTOM 2026-11-05] wire 通道停滞看门狗 —— SSH/wire 传输层。
 *
 * 为什么要有它：客户端某个子系统会**停止读自己的 SSH 通道**，可 socket 仍是 ESTABLISHED，
 * `ssh2` 不报错、`onDisconnect` 也从不触发（实测服务端 `ss -tn` 的 Send-Q 从 675 KB 涨到
 * 714 KB 还在涨，而服务端 worker 14 个、日志无 error）。于是所有 wire 调用只剩下「超时」，
 * 1.2.63 那次加的有界自动重连把这条**坏通道当成正常连接**，永远不重建，
 * 客户端就停在「接不上 / Loading chat… 永不结束」，只有重启客户端才恢复。
 *
 * 判据（只有一条，可直接审计）：**有请求在等（pending > 0）却连续 stallMs 没有任何入站帧**
 * ⇒ 通道不再读数据 ⇒ 交给调用方走**既有**的「断开 + 重建」路径（不新写连接建立逻辑）。
 * 正常空闲（pending == 0）绝不触发；连接建立中（handshaking）不触发。
 *
 * 防抖：一次停滞只触发一次。闸门是 `armed`，只有两种事件会把它重新打开 ——
 * ① 真的又收到入站帧（{@link ChannelStallWatchdog.noteInbound}：通道自证在读数据）；
 * ② 装上了新的物理连接（{@link ChannelStallWatchdog.noteConnected}：重建成功，重新计时）。
 * 所以同一段停滞期内最多重建一次；重建后又静默满 stallMs 才会再判一次，`attempt` 递增，
 * 日志能直接看出这是第几次。
 *
 * 开关：`XG_WIRE_STALL_MS`（毫秒，默认 15000，见 connection-supervisor.ts 的 resolveWireStallMs）。
 * 回滚：删掉 HostRuntimeConnection 里对本模块的调用，即回到 1.2.72 的行为（超时就只是超时）。
 */
export const DEFAULT_WIRE_STALL_MS = 15_000;
export const DEFAULT_WIRE_STALL_TICK_MS = 1_000;

/** [XG-CUSTOM 2026-11-05] 判定结果的形状就是日志里那一行：`{wstag:"stall-detect", …}`。 */
export type ChannelStallFinding = {
  wstag: 'stall-detect';
  /** 挂起请求数（已发出、未收到结果/未超时）。 */
  pending: number;
  /** 距上一次入站帧的毫秒数。 */
  idleMs: number;
  /** 本次判定用的阈值。 */
  stallMs: number;
  /** 距上一次「通道真的在送数据」以来第几次判停滞（1 起算）。 */
  attempt: number;
};

export type ChannelStallWatchdogOptions = {
  clock: Clock;
  /** 挂起请求数：复用 wire `Connection` 里已有的 pending 表，不另建一套计数。 */
  pending(): number;
  /** 物理连接还在建立/握手（没有装上的通道）时为 true —— 此时不判停滞。 */
  handshaking(): boolean;
  stallMs?: number;
  tickMs?: number;
  /** 判定停滞时调用一次，调用方负责走既有的断开 + 重建路径。 */
  onStall(finding: ChannelStallFinding): void;
};

export type ChannelStallWatchdog = {
  /** 开始节拍（幂等：已在跑就什么都不做）。 */
  start(): void;
  /** 每收到一个入站帧调用一次：刷新 lastInboundAt、打开防抖闸、把 attempt 归零。 */
  noteInbound(): void;
  /** 新的物理通道装上时调用一次：重新计时（不清 attempt，那是「第几次」）。 */
  noteConnected(): void;
  dispose(): void;
  /** 距上一次入站帧的毫秒数（诊断用）。 */
  idleMs(): number;
  /** 累计判定次数（诊断用）。 */
  readonly stalled: number;
};

export function createChannelStallWatchdog(
  options: ChannelStallWatchdogOptions
): ChannelStallWatchdog {
  const clock = options.clock;
  const stallMs = options.stallMs ?? DEFAULT_WIRE_STALL_MS;
  const tickMs = options.tickMs ?? DEFAULT_WIRE_STALL_TICK_MS;
  // [XG-CUSTOM 2026-11-05] 入站打点：每次真的收到帧就记一次，这是「通道还活着」的唯一证据。
  let lastInboundAt = clock.now();
  // [XG-CUSTOM 2026-11-05] 防抖闸：判一次就关上，直到通道自证在读数据、或换上了新连接。
  let armed = true;
  let attempts = 0;
  let stalled = 0;
  let timer: TimerHandle | undefined;
  let disposed = false;

  function schedule(): void {
    if (disposed || timer?.active) return;
    timer = clock.schedule(tickMs, tick, { unref: true });
  }

  // [XG-CUSTOM 2026-11-05] 判定：pending > 0 且静默超过阈值，两个条件缺一不可 ——
  // 正常空闲（pending == 0）永远不会触发；handshaking 期间也不触发（那是「还没连上」不是「停滞」）。
  function tick(): void {
    timer = undefined;
    if (disposed) return;
    // 先续上节拍：判定路径里抛错也不能让看门狗停摆（节拍死了比没装更难发现）。
    schedule();
    if (!armed || options.handshaking()) return;
    const pending = options.pending();
    if (pending <= 0) return;
    const idleMs = clock.now() - lastInboundAt;
    if (idleMs <= stallMs) return;
    armed = false;
    attempts += 1;
    stalled += 1;
    options.onStall({ wstag: 'stall-detect', pending, idleMs, stallMs, attempt: attempts });
  }

  return {
    start: schedule,
    noteInbound() {
      lastInboundAt = clock.now();
      armed = true;
      attempts = 0;
    },
    noteConnected() {
      lastInboundAt = clock.now();
      armed = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      void timer?.dispose();
      timer = undefined;
    },
    idleMs: () => clock.now() - lastInboundAt,
    get stalled() {
      return stalled;
    },
  };
}
