import { systemClock } from '@emdash/shared/scheduling';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChannelStallWatchdog,
  DEFAULT_WIRE_STALL_MS,
  type ChannelStallFinding,
  type ChannelStallWatchdog,
} from './channel-stall-watchdog';

// [XG-CUSTOM 2026-11-05] 通道停滞看门狗的假时钟测试。
// `vi.useFakeTimers()` 同时接管 setTimeout 与 Date.now，所以 15 s 阈值是**快进**出来的：
// 这里一次真 sleep 都没有，不碰网络、不起 SSH —— 全部是可控计时器 + 可数事件。
function createHarness(overrides: { stallMs?: number; tickMs?: number } = {}) {
  let pending = 0;
  let handshaking = false;
  const stalls: ChannelStallFinding[] = [];
  const watchdog = createChannelStallWatchdog({
    clock: systemClock,
    pending: () => pending,
    handshaking: () => handshaking,
    onStall: (finding) => stalls.push(finding),
    ...overrides,
  });
  watchdog.start();
  return {
    watchdog,
    stalls,
    setPending(value: number) {
      pending = value;
    },
    setHandshaking(value: boolean) {
      handshaking = value;
    },
  };
}

describe('wire channel stall watchdog', () => {
  let created: ChannelStallWatchdog[] = [];
  const harness = (overrides: { stallMs?: number; tickMs?: number } = {}) => {
    const made = createHarness(overrides);
    created.push(made.watchdog);
    return made;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
  });

  afterEach(() => {
    for (const watchdog of created) watchdog.dispose();
    vi.useRealTimers();
  });

  // ① 触发条件
  it('fires once when pending calls stop receiving inbound frames past the threshold', async () => {
    const subject = harness();
    subject.setPending(3);

    // 阈值以内只是「慢」，不是「坏」：14 s 静默不判。
    await vi.advanceTimersByTimeAsync(DEFAULT_WIRE_STALL_MS - 1_000);
    expect(subject.stalls).toHaveLength(0);

    // 越过阈值的那一个 tick 判定停滞。
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subject.stalls).toHaveLength(1);
    expect(subject.stalls[0]).toMatchObject({
      wstag: 'stall-detect',
      pending: 3,
      stallMs: DEFAULT_WIRE_STALL_MS,
      attempt: 1,
    });
    expect(subject.stalls[0]?.idleMs).toBeGreaterThan(DEFAULT_WIRE_STALL_MS);
  });

  // ② 有入站在继续 ⇒ 永不触发
  it('never fires while inbound frames keep arriving', async () => {
    const subject = harness();
    subject.setPending(2);

    for (let second = 0; second < 40; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      subject.watchdog.noteInbound();
    }

    expect(subject.stalls).toHaveLength(0);
  });

  // ③ 正常空闲（pending == 0）⇒ 永不触发
  it('never fires on a long idle with no pending request', async () => {
    const subject = harness();
    subject.setPending(0);

    await vi.advanceTimersByTimeAsync(300_000);

    expect(subject.stalls).toHaveLength(0);
  });

  // ④ 防抖：同一停滞期只触发一次（不是每个 tick 都重建）
  it('fires once per stall episode, not once per tick', async () => {
    const subject = harness();
    subject.setPending(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subject.stalls).toHaveLength(1);
    expect(subject.watchdog.stalled).toBe(1);
  });

  // ⑤ 重建后入站恢复 ⇒ 状态复位
  it('resets after inbound traffic resumes following a rebuild', async () => {
    const subject = harness();
    subject.setPending(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(subject.stalls).toHaveLength(1);

    // 重建成功：新物理连接装上 ⇒ 重新计时（attempt 保留，那是「第几次」）。
    subject.watchdog.noteConnected();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(subject.stalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subject.stalls.map((finding) => finding.attempt)).toEqual([1, 2]);

    // 入站真的恢复了 ⇒ 闸门与计数一起复位。
    for (let second = 0; second < 5; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      subject.watchdog.noteInbound();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subject.stalls).toHaveLength(2);
    // 复位看的是 attempt 回到 1：计数确实被 noteInbound 清零了。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subject.stalls.map((finding) => finding.attempt)).toEqual([1, 2, 1]);
  });

  // 连接建立中（handshaking）不触发
  it('never fires while the physical channel is still being established', async () => {
    const subject = harness();
    subject.setPending(4);
    subject.setHandshaking(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(subject.stalls).toHaveLength(0);

    subject.setHandshaking(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subject.stalls).toHaveLength(1);
  });

  it('honours a custom threshold and tick', async () => {
    const subject = harness({ stallMs: 3_000, tickMs: 500 });
    subject.setPending(1);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(subject.stalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subject.stalls).toHaveLength(1);
    expect(subject.stalls[0]?.stallMs).toBe(3_000);
  });
});
