// [XG-CUSTOM 2026-11-17] 中控台：Dot 运行状态 / 派工票 / 最近决策 / 中控台流 / 端口健康。
//   **照 AutomationsView 的骨架**：drag strip + max-w-4xl + px-8 + gap-8 + PageLayout.Header，
//   不要自己发明居中和间距（第一版就是因为没照原生，看起来像野页面）。
import { useEffect, useState } from 'react';
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button } from '@emdash/ui/react/primitives';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xgConsoleViewDef } from '../contributions/views';

type Ticket = { sid?: string; id?: string; stage?: string; owner?: string; title?: string; age_s?: number };
type Route = { ts: number; lane: string; task: string; outcome?: string | null };
type Status = {
  ok?: boolean;
  state?: string;
  working?: Ticket[];
  tickets?: Ticket[];
  routing?: Route[];
  flows?: string[];
  health?: Record<string, boolean>;
  af?: { unanswered_effective?: number; over_count?: number; auto_confirmable?: number };
};

function BadgeFor({ stage }: { stage?: string }) {
  const s = (stage || '').toLowerCase();
  const tone = s === 'done' ? 'success' : s === 'working' ? 'info' : s === 'stale' ? 'warning' : 'neutral';
  return <Badge tone={tone as never}>{stage || '?'}</Badge>;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border-subtle p-4">
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-foreground-muted">{hint}</div>}
    </div>
  );
}

export function XgConsoleMainPanel() {
  const [d, setD] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch('http://localhost:8900/v1/dot/status', { cache: 'no-store' });
      setD((await r.json()) as Status);
    } catch {
      /* 状态接口不通不影响页面 */
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), 5000);
    return () => clearInterval(h);
  }, []);

  const running = d?.state === 'running';
  const working = d?.working ?? [];
  const tickets = (d?.tickets ?? []).slice(0, 10);
  const routing = (d?.routing ?? []).slice(0, 10);
  const flows = d?.flows ?? [];
  const health = d?.health ?? {};
  const ports = Object.keys(health);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-cols-1 gap-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto px-8">
          <div className="flex w-full flex-col gap-8 py-8">
            <PageLayout.Header
              title="中控台"
              description="Dot 运行状态 · 派工票 · 最近决策 · 中控台流 · 端口健康（只读 /v1/dot/status）"
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={running ? 'success' : 'neutral'}>{running ? '在跑' : '空闲'}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
                    刷新
                  </Button>
                </div>
              }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="状态" value={running ? '在跑' : '空闲'} hint={running ? `${working.length} 个专家在干` : '没有正在跑的专家'} />
              <StatCard label="最近票" value={String(tickets.length)} hint="只显示最近 10 张" />
              <StatCard
                label="AF 待接"
                value={String(d?.af?.unanswered_effective ?? '—')}
                hint={`超 7 天 ${d?.af?.over_count ?? '—'} · 可自动 ${d?.af?.auto_confirmable ?? '—'}`}
              />
              <StatCard
                label="端口"
                value={`${ports.filter((p) => health[p]).length}/${ports.length || '—'}`}
                hint={ports.join(' · ')}
              />
            </div>

            <section className="flex flex-col gap-2">
              <div className="text-sm font-medium">在派工</div>
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {working.length === 0 && (
                  <div className="px-3 py-3 text-sm text-foreground-muted">没有正在跑的票</div>
                )}
                {working.map((t, i) => (
                  <div key={`${t.id}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <BadgeFor stage="working" />
                    <span className="w-24 shrink-0 truncate text-foreground-muted">{t.owner || '?'}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title || '(无标题)'}</span>
                    <span className="shrink-0 text-xs text-foreground-muted">{t.age_s ?? 0}s</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-sm font-medium">最近票（{tickets.length}）</div>
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {tickets.map((t, i) => (
                  <div key={`${t.id}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <BadgeFor stage={t.stage} />
                    <span className="w-24 shrink-0 truncate text-foreground-muted">{t.owner || '?'}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title || '(无标题)'}</span>
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {typeof t.age_s === 'number' ? `${Math.round(t.age_s / 3600)}h` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-sm font-medium">最近决策（{routing.length}）</div>
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {routing.length === 0 && (
                  <div className="px-3 py-3 text-sm text-foreground-muted">还没有决策记录</div>
                )}
                {routing.map((r, i) => (
                  <div key={`${r.ts}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Badge tone={r.lane === 'r0' ? 'success' : 'neutral'}>{r.lane}</Badge>
                    <span className="min-w-0 flex-1 truncate text-foreground-muted">{r.task.slice(0, 80)}</span>
                    <span className="shrink-0 text-xs text-foreground-muted">{r.outcome || '—'}</span>
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-sm font-medium">中控台流（{flows.length}）</div>
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {flows.map((f, i) => (
                  <div key={i} className="px-3 py-2 text-sm text-foreground-muted">{f}</div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export const xgConsoleViewRuntime = defineViewRuntime(xgConsoleViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgConsoleMainPanel },
});
