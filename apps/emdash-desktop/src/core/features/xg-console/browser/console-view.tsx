// [XG-CUSTOM 2026-11-17] 中控台（见 emdash/CUSTOMIZATIONS.md）
// 只读 /v1/dot/status：state / working / tickets / flows / health
// 为什么不在这里存票：票文件是唯一真相源，复制一份必然与 agent 侧不一致。
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button } from '@emdash/ui/react/primitives';
import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xgConsoleViewDef } from '../contributions/views';

type Ticket = {
  sid?: string;
  id: string;
  title?: string;
  name?: string;
  stage: string;
  owner: string;
  age_s: number;
};
type Status = {
  state?: string;
  working?: Ticket[];
  tickets?: Ticket[];
  flows?: string[];
  health?: Record<string, boolean>;
  af?: { unanswered_effective?: number; over_count?: number; auto_confirmable?: number; by_workspace?: Record<string, number>; error?: string };
};

function ageTxt(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function XgConsoleMainPanel() {
  const [d, setD] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('http://localhost:8900/v1/dot/status', { cache: 'no-store' });
      setD((await r.json()) as Status);
      setErr('');
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).slice(0, 80));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), 3000);
    return () => clearInterval(h);
  }, [load]);

  const running = d?.state === 'running';
  const working = d?.working ?? [];
  const tickets = (d?.tickets ?? []).slice(0, 10);
  const flows = d?.flows ?? [];
  const health = Object.entries(d?.health ?? {});
  const af = d?.af;

  return (
    <PageLayout.Content className="space-y-4 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Activity className="h-4 w-4" />
          中控台
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {err && (
        <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-foreground-danger">
          状态接口不通（{err}）—— Dot 服务可能没起，数据不可信
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle px-3 py-2 text-sm">
        <span className={cn('font-medium', running ? 'text-foreground-success' : 'text-foreground-muted')}>
          {running ? `● 在跑 ${working.length}` : '○ 空闲'}
        </span>
        <span className="text-xs text-foreground-muted">
          {working.length > 0 ? working.map((w) => `${w.owner} ${ageTxt(w.age_s)}`).join('、') : '没有正在跑的专家'}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-foreground-muted">
          {health.map(([k, v]) => (
            <span key={k} className={v ? 'text-foreground-success' : 'text-foreground-danger'}>
              {k} {v ? '✓' : '✗'}
            </span>
          ))}
        </span>
      </div>

      <section className="space-y-1">
        <div className="text-xs font-medium text-foreground-muted">在派工</div>
        {working.length === 0 && <div className="text-xs text-foreground-muted">—</div>}
        {working.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
            <Badge variant="soft" tone="info">working</Badge>
            <span className="font-mono text-xs">{t.owner}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
              {(t.title || t.name || t.id).slice(0, 80)}
            </span>
            <span className="text-xs text-foreground-muted">{ageTxt(t.age_s)}</span>
          </div>
        ))}
      </section>

      <section className="space-y-1">
        <div className="text-xs font-medium text-foreground-muted">最近票（{tickets.length}）</div>
        {tickets.map((t) => (
          <div key={`${t.sid}-${t.id}`} className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-1.5 text-xs">
            <Badge variant="neutral">{t.stage}</Badge>
            <span className="font-mono">{t.owner}</span>
            <span className="min-w-0 flex-1 truncate text-foreground-muted">
              {(t.title || t.name || t.id).slice(0, 90)}
            </span>
            <span className="text-foreground-muted">{ageTxt(t.age_s)}</span>
          </div>
        ))}
      </section>

      <section className="space-y-1">
        {af && (
          <div className="text-xs text-fg-muted">
            AF 待接 <b>{af.unanswered_effective ?? '?'}</b>
            （超 7 天 {af.over_count ?? '?'} · 可自动确认 {af.auto_confirmable ?? '?'}）
            {af.error ? <span className="text-danger"> · {af.error}</span> : null}
          </div>
        )}
        <div className="text-xs font-medium text-foreground-muted">中控台流（{flows.length}）</div>
        {flows.map((f) => (
          <div key={f} className="rounded-md border border-border-subtle px-3 py-1 font-mono text-xs text-foreground-muted">
            {f}
          </div>
        ))}
      </section>
    </PageLayout.Content>
  );
}

export const xgConsoleViewRuntime = defineViewRuntime(xgConsoleViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgConsoleMainPanel },
});
