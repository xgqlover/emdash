import type { ResourceUsageSample } from '@emdash/core/runtimes/resource-usage/api';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMachineMetrics, type MachineMetricsView } from './use-machine-metrics';

// [XG-CUSTOM 2026-11-02] 「资源面板在『有值』和『— / Unavailable』之间反复跳」的回归测试。
// 判据：单次取样失败**绝不丢数值**；连续 3 次失败才 stale；只有从没采到过才是 null。
const mocks = vi.hoisted(() => ({
  getMachineMetrics: vi.fn(),
  stateFor: vi.fn(),
}));

vi.mock('@core/features/machines/api/browser/client', () => ({
  getMachinesClient: async () => ({ getMachineMetrics: mocks.getMachineMetrics }),
}));

vi.mock('@core/features/machines/contributions/app-stores', () => ({
  getMachinesStore: () => ({ stateFor: mocks.stateFor }),
}));

const SAMPLE: ResourceUsageSample = {
  cpu: { usedPercent: 12 },
  memory: { usedPercent: 34, usedBytes: 3_400, totalBytes: 10_000 },
  disk: { usedPercent: 56, usedBytes: 56_000, totalBytes: 100_000, path: '/' },
  collectedAt: 1,
};

describe('useMachineMetrics', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let tickCallbacks: Array<() => void>;
  let latest: MachineMetricsView | null;
  let now: number;

  /** Reading through a call keeps TS from narrowing `latest` to `null` after a reset. */
  const view = (): MachineMetricsView | null => latest;

  /** Runs one 5 s polling tick and lets the awaited sample settle. */
  async function tick(): Promise<void> {
    now += 5_000;
    await act(async () => {
      for (const callback of [...tickCallbacks]) callback();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    tickCallbacks = [];
    latest = null;
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal(
      'window',
      new Proxy(dom.window, {
        get: (target, property) => {
          if (property === 'setInterval') {
            return (callback: () => void) => {
              tickCallbacks.push(callback);
              return tickCallbacks.length;
            };
          }
          if (property === 'clearInterval') return () => {};
          return Reflect.get(target, property);
        },
      })
    );
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    mocks.stateFor.mockReturnValue('connected');
    mocks.getMachineMetrics.mockResolvedValue(SAMPLE);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container, { onCaughtError: () => {} });
    function Probe(): null {
      latest = useMachineMetrics(undefined, true);
      return null;
    }
    act(() => {
      root.render(React.createElement(Probe));
    });
    // The mount-time refresh is async; one microtask flush settles it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  it('shows the first successful sample as fresh', () => {
    expect(latest).not.toBeNull();
    expect(latest?.metrics).toBe(SAMPLE);
    expect(latest?.stale).toBe(false);
    expect(latest?.consecutiveFailures).toBe(0);
  });

  it('keeps the last value after a single failed poll', async () => {
    mocks.getMachineMetrics.mockRejectedValueOnce(new Error('Wire transport disconnected'));
    await tick();

    expect(latest).not.toBeNull();
    expect(latest?.metrics).toBe(SAMPLE);
    expect(latest?.stale).toBe(false);
    expect(latest?.consecutiveFailures).toBe(1);
    expect(latest?.ageMs).toBe(5_000);
  });

  it('marks the frame stale only after three consecutive failures, keeping the value', async () => {
    mocks.getMachineMetrics.mockRejectedValue(new Error('Wire transport disconnected'));

    await tick();
    expect(latest?.stale).toBe(false);
    await tick();
    expect(latest?.stale).toBe(false);
    await tick();

    expect(latest?.stale).toBe(true);
    expect(latest?.consecutiveFailures).toBe(3);
    expect(latest?.metrics).toBe(SAMPLE);
    expect(latest?.ageMs).toBe(15_000);
  });

  it('clears the stale flag on the next good sample', async () => {
    mocks.getMachineMetrics.mockRejectedValue(new Error('down'));
    await tick();
    await tick();
    await tick();
    expect(latest?.stale).toBe(true);

    mocks.getMachineMetrics.mockResolvedValue(SAMPLE);
    await tick();

    expect(latest?.stale).toBe(false);
    expect(latest?.consecutiveFailures).toBe(0);
    expect(latest?.ageMs).toBe(0);
  });

  it('stays null when nothing was ever sampled (that is a real "—")', async () => {
    act(() => root.unmount());
    latest = null;
    tickCallbacks = [];
    mocks.getMachineMetrics.mockRejectedValue(new Error('down'));
    root = createRoot(container, { onCaughtError: () => {} });
    function Probe(): null {
      latest = useMachineMetrics(undefined, true);
      return null;
    }
    act(() => {
      root.render(React.createElement(Probe));
    });
    await tick();
    await tick();
    await tick();

    expect(latest).toBeNull();
  });

  it('treats a disconnected store as a failed poll, never as a reason to blank the panel', async () => {
    // The store's connection state only gates *remote* hosts (`machineId` is
    // required): for the local host there is no SSH connection to consult. So
    // this case mounts a remote probe, seeds one good frame, then disconnects.
    const baseline = mocks.getMachineMetrics.mock.calls.length; // the default probe's mount
    act(() => root.unmount());
    latest = null;
    tickCallbacks = [];
    mocks.stateFor.mockReturnValue('connected');
    root = createRoot(container, { onCaughtError: () => {} });
    function RemoteProbe(): null {
      latest = useMachineMetrics('machine-1', true);
      return null;
    }
    act(() => {
      root.render(React.createElement(RemoteProbe));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view()?.metrics).toBe(SAMPLE);
    expect(mocks.getMachineMetrics).toHaveBeenCalledTimes(baseline + 1);

    mocks.stateFor.mockReturnValue('disconnected');
    await tick();
    expect(view()?.metrics).toBe(SAMPLE);
    expect(view()?.stale).toBe(false);
    // A disconnected host must not fire RPCs every tick…
    expect(mocks.getMachineMetrics).toHaveBeenCalledTimes(baseline + 1);

    await tick();
    await tick();
    expect(view()?.metrics).toBe(SAMPLE);
    expect(view()?.stale).toBe(true);
    expect(mocks.getMachineMetrics).toHaveBeenCalledTimes(baseline + 1);
  });
});
