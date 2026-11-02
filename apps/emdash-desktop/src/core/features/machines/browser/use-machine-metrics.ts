import type { ResourceUsageSample } from '@emdash/core/runtimes/resource-usage/api';
import { useEffect, useRef, useState } from 'react';
import { getMachinesClient } from '@core/features/machines/api/browser/client';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';

const REFRESH_INTERVAL_MS = 5_000;

// [XG-CUSTOM 2026-11-02] 修「资源面板在『有值』和『— / Unavailable』之间反复跳」。
//   旧实现：任何一次取样失败（或 store 里 connected 抖一下）都 `setState(null)` ⇒ 面板清空
//   ⇒ 渲染成 `—` / `Unavailable`。5 秒一轮询，链路一抖就跳一次。
//   新实现：**永远保留上一帧数值**，只累计连续失败次数；连续失败 ≥ STALE_AFTER_FAILURES（3 次）
//   才给这帧打 `stale` 标（UI 显示灰字 stale + 上次采样时间），**单次失败绝不丢数值**；
//   只有「从来没有采到过」才返回 null（那才是真的 `—`）。
const STALE_AFTER_FAILURES = 3;

export interface MachineMetricsView {
  metrics: ResourceUsageSample;
  /** True once sampling has failed STALE_AFTER_FAILURES times in a row. */
  stale: boolean;
  /** Time since the last successful sample, refreshed on every attempt. */
  ageMs: number;
  consecutiveFailures: number;
  /** `Date.now()` of the last successful sample. */
  sampledAt: number;
}

interface MetricsState extends MachineMetricsView {
  hostKey: string;
}

export function useMachineMetrics(
  machineId: string | undefined,
  enabled: boolean
): MachineMetricsView | null {
  const hostKey = machineId ?? 'local';
  const [state, setState] = useState<MetricsState | null>(null);
  // `enabled` flips with remote-runtime availability, which flaps independently of
  // the sample loop; read it inside `refresh` so a flip cannot restart the effect
  // (and therefore cannot clear the frame).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let cancelled = false;

    const publishSample = (metrics: ResourceUsageSample): void => {
      if (cancelled) return;
      setState({
        hostKey,
        metrics,
        stale: false,
        ageMs: 0,
        consecutiveFailures: 0,
        sampledAt: Date.now(),
      });
    };

    const publishFailure = (): void => {
      if (cancelled) return;
      setState((previous) => {
        // Never sampled for this host ⇒ nothing to keep; the panel shows "—".
        if (!previous || previous.hostKey !== hostKey) return previous;
        const consecutiveFailures = previous.consecutiveFailures + 1;
        return {
          ...previous,
          consecutiveFailures,
          stale: consecutiveFailures >= STALE_AFTER_FAILURES,
          ageMs: Date.now() - previous.sampledAt,
        };
      });
    };

    const refresh = async (): Promise<void> => {
      // A disconnected host, or a host whose runtime is not usable yet, counts as one
      // failed sample instead of wiping the frame: the store's connection state flaps
      // on its own schedule and used to blank the panel on its own.
      const connected = machineId ? getMachinesStore().stateFor(machineId) === 'connected' : true;
      if (!enabledRef.current || !connected) {
        publishFailure();
        return;
      }
      try {
        const client = await getMachinesClient();
        const metrics = await client.getMachineMetrics(machineId ? { machineId } : {});
        publishSample(metrics);
      } catch {
        publishFailure();
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hostKey, machineId]);

  if (!state || state.hostKey !== hostKey) return null;
  return {
    metrics: state.metrics,
    stale: state.stale,
    ageMs: state.ageMs,
    consecutiveFailures: state.consecutiveFailures,
    sampledAt: state.sampledAt,
  };
}
