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

type Route = { ts: number; lane: string; task: string; outcome?: string | null };
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
  const routing = (d?.routing ?? []).slice(0, 10);
  const flows = d?.flows ?? [];
  const health = Object.entries(d?.health ?? {});
  const af = d?.af;

  const card = 'rounded-lg border border-border-subtle bg-surface p-4';
  const stat = (label: string, value: React.ReactNode, hint?: string) => (
    <div className={card}>
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-foreground-muted">{hint}</div> : null}
    </div>
  );

  return (
    <>
      <PageLayout.Header
        title="中控台"
        description="Dot 运行状态 · 派工票 · 中控台流 · 端口健康（只读 /v1/dot/status）"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="soft" tone={running ? 'success' : 'neutral'}>
              {running ? `在跑 ${working.length}` : '空闲'}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
        sticky
      />
      <PageLayout.Content className="space-y-4 overflow-auto p-4">
        {err && (
          <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-foreground-danger">
            状态接口不通（{err}）—— Dot 服务可能没起，数据不可信
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          {stat('状态', running ? '运行中' : '空闲',
            working.length ? working.map((w) => `${w.owner} ${ageTxt(w.age_s)}`).join('、') : '没有正在跑的专家')}
          {stat('最近票', tickets.length, `共 ${d?.tickets?.length ?? 0} 张（只显示最近 10）`)}
          {stat('AF 待接', af?.unanswered_effective ?? '—',
            af ? `超 7 天 ${af.over_count ?? '?'} · 可自动 ${af.auto_confirmable ?? '?'}` : '暂无数据')}
          {stat('端口', `${health.filter(([, v]) => v).length}/${health.length}`,
            health.map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' · '))}
        </div>

        <section className="space-y-2">
          <div className="text-sm font-medium">在派工</div>
          {working.length === 0 ? (
            <div className={cn(card, 'text-sm text-foreground-muted')}>没有正在跑的票</div>
          ) : (
            <div className="space-y-1">
              {working.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
                  <Badge variant="soft" tone="info">working</Badge>
                  <span className="font-mono text-xs">{t.owner}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {(t.title || t.name || t.id).slice(0, 90)}
                  </span>
                  <span className="text-xs text-foreground-muted">{ageTxt(t.age_s)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="space-y-2 lg:col-span-2">
            <div className="text-sm font-medium">最近票（{tickets.length}）</div>
            <div className={cn(card, 'space-y-1 p-2')}>
              {tickets.map((t) => (
                <div key={`${t.sid}-${t.id}`}
                     className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
                  <Badge variant="neutral">{t.stage}</Badge>
                  <span className="font-mono text-xs">{t.owner}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {(t.title || t.name || t.id).slice(0, 90)}
                  </span>
                  <span className="text-xs text-foreground-muted">{ageTxt(t.age_s)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2 lg:col-span-2">
            <div className="text-sm font-medium">最近决策（{routing.length}）</div>
            <div className={cn(card, 'space-y-1 p-2')}>
              {routing.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-foreground-muted">还没有决策记录</div>
              )}
              {routing.map((r, i) => (
                <div key={`${r.ts}-${i}`}
                     className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
                  <Badge variant={r.lane === 'r0' ? 'success' : 'neutral'}>{r.lane}</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {r.task.slice(0, 90)}
                  </span>
                  <span className="text-xs text-foreground-muted">{r.outcome || '—'}</span>
                  <span className="text-xs text-foreground-muted">
                    {new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-sm font-medium">中控台流（{flows.length}）</div>
            <div className={cn(card, 'max-h-[420px] space-y-1 overflow-auto p-2')}>
              {flows.map((f) => (
                <div key={f} className="rounded px-2 py-1 font-mono text-xs text-foreground-muted hover:bg-surface-hover">
                  {f}
                </div>
              ))}
            </div>
          </section>
        </div>
      </PageLayout.Content>
    </>
  );
}

export const xgConsoleViewRuntime = defineViewRuntime(xgConsoleViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgConsoleMainPanel },
});
