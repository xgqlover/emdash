import { Box, Field } from '@emdash/ui/react/primitives';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]
import type { MachineMetricsView } from '../use-machine-metrics';

// [XG-CUSTOM 2026-11-02] 面板只在「从来没有采到过」时才显示 `—` / `Unavailable`；
//   采到过就永远显示数值，掉线后由灰字 `stale · 上次采样 N 前` 表达「这帧旧了」。
export function ResourceUtilizationRow({ metrics }: { metrics: MachineMetricsView | null }) {
  const sample = metrics?.metrics ?? null;
  const stale = metrics?.stale ?? false;
  const ageMs = metrics?.ageMs ?? 0;
  return (
    <Field.Root className="flex flex-col gap-3">
      <Field.Label>{t('resource_utilization')}</Field.Label>
      <div className="mt-1 grid grid-cols-3 gap-2">
        <ResourceCard
          label="CPU"
          value={sample ? formatPercent(sample.cpu.usedPercent) : '—'}
          description="Utilization"
          stale={stale}
          ageMs={ageMs}
        />
        <ResourceCard
          label="Memory"
          value={sample ? formatPercent(sample.memory.usedPercent) : '—'}
          description={
            sample
              ? `${formatBytes(sample.memory.usedBytes)} / ${formatBytes(sample.memory.totalBytes)}`
              : 'Unavailable'
          }
          stale={stale}
          ageMs={ageMs}
        />
        <ResourceCard
          label="Disk"
          value={sample ? formatPercent(sample.disk.usedPercent) : '—'}
          description={
            sample
              ? `${formatBytes(sample.disk.usedBytes)} / ${formatBytes(sample.disk.totalBytes)}`
              : 'Unavailable'
          }
          stale={stale}
          ageMs={ageMs}
        />
      </div>
    </Field.Root>
  );
}

function ResourceCard({
  label,
  value,
  description,
  stale = false,
  ageMs = 0,
}: {
  label: string;
  value: string;
  description: string;
  stale?: boolean;
  ageMs?: number;
}) {
  return (
    <Box surface="sunken" borderRadius="md" padding="2" px="3" className="min-w-0">
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="mt-1 text-lg font-medium text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-foreground-passive tabular-nums">
        {description}
      </div>
      {/* [XG-CUSTOM 2026-11-02] 灰字 stale 标：数值保留，只标注这帧多旧 */}
      {stale && (
        <div
          data-testid="resource-stale"
          className="mt-0.5 truncate text-[11px] text-foreground-passive tabular-nums"
        >
          {`stale · sampled ${formatAge(ageMs)} ago`}
        </div>
      )}
    </Box>
  );
}

function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(maximumFractionDigits)} ${units[unitIndex]}`;
}
