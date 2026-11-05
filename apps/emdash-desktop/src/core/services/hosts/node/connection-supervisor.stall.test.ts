import { log } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFaultPeer,
  createSupervisorDriver,
  observePromise,
  resourceClient,
} from './testing/connection-supervisor-fixture';

// [XG-CUSTOM 2026-11-05] 通道停滞 ⇒ 走既有「断开 + 重建」路径 的端到端回归。
// 这里用的全是**真**的客户端生命周期（supervisor + HostRuntimeConnection + wire Connection），
// 只把网络换成一内存传输对（fixture）：`dropReplies = true` 就是「客户端不再读自己的通道」——
// 请求发得出去、回帧永远不来，而 socket 依旧 ESTABLISHED、`onDisconnect` 一次都不触发。
const STALL_LOG = 'wire channel stalled; rebuilding host connection';

describe('Host supervisor channel-stall recovery', () => {
  let peer: ReturnType<typeof createFaultPeer>;
  let driver: ReturnType<typeof createSupervisorDriver> | undefined;
  const savedStallMs = process.env.XG_WIRE_STALL_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    peer = createFaultPeer();
    driver = undefined;
  });

  afterEach(async () => {
    if (driver) await driver.dispose();
    await peer.dispose();
    driver = undefined;
    if (savedStallMs === undefined) delete process.env.XG_WIRE_STALL_MS;
    else process.env.XG_WIRE_STALL_MS = savedStallMs;
    vi.useRealTimers();
  });

  it('rebuilds the host connection when pending calls stop receiving inbound frames', async () => {
    // 健康检查放到 10 分钟：本用例只能由看门狗救回来，慢探针不许抢功。
    driver = createSupervisorDriver(peer, { healthIntervalMs: 600_000 });
    await driver.connect();
    expect(peer.opens).toBe(1);
    const warn = vi.spyOn(log, 'warn');
    try {
      peer.current.dropReplies = true;
      const pending = observePromise(resourceClient(await driver.getAttachment()).increment());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pending.outcome).toBe('pending');

      // 15 s 阈值 + 1 s tick：越过阈值的那一个 tick 判定停滞，交给既有的断开 + 重建。
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(10);

      expect(peer.opens).toBe(2);
      expect(driver.state.kind).toBe('ready');
      // 结构化日志：一眼能算出「挂了几个、静了多久、阈值多少、第几次」。
      const stallLine = warn.mock.calls.find(([message]) => message === STALL_LOG);
      expect(stallLine?.[1]).toMatchObject({
        wstag: 'stall-detect',
        pending: 1,
        stallMs: 15_000,
        attempt: 1,
      });
      expect(Number(stallLine?.[1]?.idleMs)).toBeGreaterThan(15_000);
      // 坏通道上的挂起请求被断开路径清掉，不再无限重试。
      expect(pending.outcome).toBe('rejected');
    } finally {
      warn.mockRestore();
    }
  });

  it('honours the XG_WIRE_STALL_MS override', async () => {
    process.env.XG_WIRE_STALL_MS = '5000';
    driver = createSupervisorDriver(peer, { healthIntervalMs: 600_000 });
    await driver.connect();
    peer.current.dropReplies = true;
    observePromise(resourceClient(await driver.getAttachment()).increment());

    // 6 s 就够：默认 15 s 在这个时刻还不会触发。
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(10);

    expect(peer.opens).toBe(2);
  });

  it('leaves a healthy idle channel alone', async () => {
    driver = createSupervisorDriver(peer, { healthIntervalMs: 600_000 });
    await driver.connect();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(peer.opens).toBe(1);
    expect(driver.state.kind).toBe('ready');
  });
});
