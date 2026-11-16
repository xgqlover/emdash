// [XG-CUSTOM 2026-11-17] 中控台：照 emdash 原生骨架（PageLayout + CardGrid + CollectionView + Sheet）
//   - 数据只读 /v1/dot/status（票 / 决策 / 流 / 端口 / AF），不在渲染进程存副本
//   - 第一层：4 张概览卡 + 2×2 四张卡片；第二层：点一行 → 右侧 Sheet 看全量
import { useCallback, useEffect, useState } from 'react';
import { PageLayout, CollectionView } from '@emdash/ui/react/patterns';
import { Badge, Button, MicroLabel, Sheet } from '@emdash/ui/react/primitives';
import { CardGrid, CardGridItem, EmptyState } from '@emdash/ui/react/components';
import { XgConsoleIcon } from './icon';

type Ticket = {
  sid?: string; id?: string; title?: string; stage?: string; owner?: string;
  age_s?: number; closed?: number;
};
type Route = { ts: number; lane: string; task: string; why?: string; outcome?: string | null };
type Flow = { name: string; estimate?: string; confidence?: string; stage?: string };
type Status = {
  ok?: boolean; state?: string; working?: Ticket[]; tickets?: Ticket[]; routing?: Route[];
  flows?: (Flow | string)[]; health?: Record<string, boolean>;
  af?: { ok?: boolean; unanswered_effective?: number; over_count?: number; auto_confirmable?: number; by_workspace?: Record<string, number> };
  routing_stats?: { window_h?: number; lanes?: Record<string, number>; busy?: number; handback?: number; total?: number; slots?: number };
};

const LANE_TONE: Record<string, 'success' | 'info' | 'neutral'> = { r0: 'success', fast: 'info', d1: 'neutral' };
// [XG 2026-11-17] 前置分流 6 条 lane 的中文名（顺序就是展示顺序）
const FRONT_LANES: [string, string][] = [
  ['translate', '翻译'], ['summarize', '摘要'], ['polish', '润色'],
  ['lookup', '查维基'], ['extract', '抽取'],
];
const STAGE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  done: 'success', working: 'info', stale: 'warning',
};

function fmtAge(s?: number) {
  if (s === undefined || s === null) return '—';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-foreground-muted">{count}</span>
      </div>
      {children}
    </section>
  );
}

// [XG-CUSTOM 2026-11-17] 一条 = 一张可点的小卡（不再用长条 Row）
function ItemCard({ onClick, top, title, meta, tone }: {
  onClick: () => void; top?: React.ReactNode; title: string; meta?: React.ReactNode;
  tone?: 'success' | 'info' | 'warning' | 'neutral';
}) {
  return (
    <CardGridItem onClick={onClick} className="min-h-24">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {tone ? <Badge tone={tone} variant="outline">{top}</Badge> : <MicroLabel>{top}</MicroLabel>}
        </div>
        <div className="line-clamp-2 text-sm">{title}</div>
        <div className="truncate text-xs text-foreground-muted">{meta}</div>
      </div>
    </CardGridItem>
  );
}

export function XgConsoleMainPanel() {
  const [d, setD] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ kind: 'ticket' | 'route' | 'af' | 'port' | 'flow'; item?: unknown } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('http://127.0.0.1:8900/v1/dot/status', { cache: 'no-store' });
      setD(await r.json()); setErr(null);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); const h = window.setInterval(() => void load(), 3000); return () => window.clearInterval(h); }, [load]);

  const running = d?.state === 'running';
  const working = d?.working ?? [];
  const tickets = d?.tickets ?? [];
  const routing = d?.routing ?? [];
  const flows = (d?.flows ?? []) as (Flow | string)[];
  const health = d?.health ?? {};
  const healthOk = Object.values(health).filter(Boolean).length;
  const flowItems = flows.map((f, i) => typeof f === 'string'
    ? { name: f, estimate: '', confidence: '', stage: '' }
    : { name: f.name, estimate: f.estimate ?? '', confidence: f.confidence ?? '', stage: f.stage ?? '' });

  return (
    <PageLayout>
      <PageLayout.Content maxWidth="4xl">
          <PageLayout.Header
            title="中控台"
            description="Dot 运行状态 · 派工票 · 最近决策 · 中控台流 · 端口健康（只读 /v1/dot/status）"
            sticky
            actions={
              <div className="flex items-center gap-2">
                <Badge tone={running ? 'success' : 'neutral'} variant="outline">{running ? '在跑' : '空闲'}</Badge>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>刷新</Button>
              </div>
            }
          />

          {err && <div className="py-2 text-xs text-foreground-danger">状态接口不通（8900 没起或被挡）：{err}</div>}

          <CardGrid className="mt-4">
            <CardGridItem onClick={() => setSel({ kind: 'ticket' })}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <MicroLabel>状态</MicroLabel>
                <div className="text-2xl font-semibold">{running ? '在跑' : '空闲'}</div>
                <div className="truncate text-xs text-foreground-muted">{running ? `${working.length} 个专家` : '没有正在跑的专家'}</div>
              </div>
            </CardGridItem>
            <CardGridItem onClick={() => setSel({ kind: 'ticket' })}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <MicroLabel>最近票</MicroLabel>
                <div className="text-2xl font-semibold">{tickets.length}</div>
                <div className="truncate text-xs text-foreground-muted">点开看详情</div>
              </div>
            </CardGridItem>
            <CardGridItem onClick={() => setSel({ kind: 'af', item: d?.af })}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <MicroLabel>AF 待接</MicroLabel>
                <div className="text-2xl font-semibold">{d?.af?.unanswered_effective ?? '—'}</div>
                <div className="truncate text-xs text-foreground-muted">超 7 天 {d?.af?.over_count ?? '—'} · 可自动 {d?.af?.auto_confirmable ?? '—'}</div>
              </div>
            </CardGridItem>
            <CardGridItem onClick={() => setSel({ kind: 'port', item: health })}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <MicroLabel>端口</MicroLabel>
                <div className="text-2xl font-semibold">{healthOk}/{Object.keys(health).length}</div>
                <div className="truncate text-xs text-foreground-muted">{Object.entries(health).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' · ')}</div>
              </div>
            </CardGridItem>
          </CardGrid>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="在派工" count={working.length}>
              {working.length === 0 ? (
                <EmptyState title="没有正在跑的票" description="派工后这里会出现卡片，点开看详情" />
              ) : (
                <CardGrid className="grid-cols-1">
                  {working.map((t, i) => (
                    <ItemCard key={`w-${i}`} tone={STAGE_TONE[t.stage || ''] || 'info'} top={t.stage || 'working'}
                      title={t.title || '(无标题)'} meta={`${t.owner || '?'} · ${fmtAge(t.age_s)}`}
                      onClick={() => setSel({ kind: 'ticket', item: t })} />
                  ))}
                </CardGrid>
              )}
            </Section>

            <Section title={`分流档位（${d?.routing_stats?.window_h ?? 24}h）`}
                     count={(d?.routing_stats?.total ?? 0)}>
              {(() => {
                const st = d?.routing_stats || {};
                const lanes = st.lanes || {};
                const rows = FRONT_LANES.map(([k, label]) => ({ k, label, n: lanes[k] || 0 }));
                const has = rows.some((r) => r.n > 0);
                if (!has) return <EmptyState title="还没有分流记录" />;
                return (
                  <CardGrid className="grid-cols-2 lg:grid-cols-3">
                    {rows.map((r) => (
                      <CardGridItem key={r.k} onClick={() => setSel({ kind: 'route', item: routing.find((x) => x.lane === r.k) })}>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <MicroLabel>{r.label}</MicroLabel>
                          <div className="text-xl font-semibold">{r.n}</div>
                          <div className="truncate text-xs text-foreground-muted">
                            槽位占满 {st.busy ?? 0} · 回落 {st.handback ?? 0}
                          </div>
                        </div>
                      </CardGridItem>
                    ))}
                  </CardGrid>
                );
              })()}
            </Section>

            <Section title="最近票" count={tickets.length}>
              {tickets.length === 0 ? (
                <EmptyState title="还没有票" description="每派一次活就多一张卡" />
              ) : (
                <CardGrid className="grid-cols-1">
                  {tickets.slice(0, 6).map((t, i) => (
                    <ItemCard key={`t-${i}`} tone={STAGE_TONE[t.stage || ''] || 'neutral'} top={t.stage || '?'}
                      title={t.title || '(无标题)'} meta={`${t.owner || '?'} · ${fmtAge(t.age_s)}`}
                      onClick={() => setSel({ kind: 'ticket', item: t })} />
                  ))}
                </CardGrid>
              )}
            </Section>

            <Section title="最近决策" count={routing.length}>
              {routing.length === 0 ? (
                <EmptyState title="还没有决策记录" description="走过前置分流就会记一条" />
              ) : (
                <CardGrid className="grid-cols-1">
                  {routing.slice(0, 6).map((r, i) => (
                    <ItemCard key={`r-${i}`} tone={LANE_TONE[r.lane] || 'neutral'} top={r.lane}
                      title={r.task || '(无任务)'} meta={r.why || r.outcome || '—'}
                      onClick={() => setSel({ kind: 'route', item: r })} />
                  ))}
                </CardGrid>
              )}
            </Section>

            <Section title="中控台流" count={flowItems.length}>
              {flowItems.length === 0 ? (
                <EmptyState title="没有登记流" description="有常驻循环时会在这里出现" />
              ) : (
                <CardGrid className="grid-cols-1">
                  {flowItems.map((f, i) => (
                    <ItemCard key={`f-${i}`} top="flow" title={f.name}
                      meta={`${f.estimate || '—'} · ${f.confidence || '—'}`}
                      onClick={() => setSel({ kind: 'flow', item: f })} />
                  ))}
                </CardGrid>
              )}
            </Section>
          </div>
      </PageLayout.Content>

      <Sheet.Root open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>
        <Sheet.Content>
          <Sheet.Header>
            <Sheet.Title>
              {sel?.kind === 'ticket' ? '派工票' : sel?.kind === 'route' ? '路由决策' : sel?.kind === 'af' ? 'AF 待接' : sel?.kind === 'port' ? '端口健康' : '中控台流'}
            </Sheet.Title>
          </Sheet.Header>
          <Sheet.Body>
            {sel?.kind === 'ticket' && (() => {
              const t = (sel.item as Ticket) || (working[0] ?? tickets[0] ?? {});
              return (
                <div className="space-y-3 text-sm">
                  <div><span className="text-foreground-muted">标题：</span>{t.title || '(无)'}</div>
                  <div><span className="text-foreground-muted">专家：</span>{t.owner || '—'}</div>
                  <div><span className="text-foreground-muted">阶段：</span>{t.stage || '—'}</div>
                  <div><span className="text-foreground-muted">年龄：</span>{fmtAge(t.age_s)}</div>
                  <div className="break-all"><span className="text-foreground-muted">会话：</span>{t.sid || '—'}</div>
                  <div><span className="text-foreground-muted">票号：</span>{t.id || '—'}</div>
                </div>
              );
            })()}
            {sel?.kind === 'route' && (() => {
              const r = (sel.item as Route) || routing[0];
              return (
                <div className="space-y-3 text-sm">
                  <div><span className="text-foreground-muted">通道：</span>{r?.lane}</div>
                  <div><span className="text-foreground-muted">依据：</span>{r?.why || '（旧记录无 why）'}</div>
                  <div className="whitespace-pre-wrap break-words"><span className="text-foreground-muted">任务：</span>{r?.task}</div>
                  <div><span className="text-foreground-muted">结果：</span>{r?.outcome || '—'}</div>
                  <div><span className="text-foreground-muted">时间：</span>{r ? new Date(r.ts).toLocaleString('zh-CN') : '—'}</div>
                </div>
              );
            })()}
            {sel?.kind === 'af' && (() => {
              const af = (sel.item as Status['af']) || {};
              const by = af.by_workspace || {};
              return (
                <div className="space-y-3 text-sm">
                  <div><span className="text-foreground-muted">待接：</span>{af.unanswered_effective ?? '—'}（超 7 天 {af.over_count ?? '—'}）</div>
                  <div><span className="text-foreground-muted">可自动确认：</span>{af.auto_confirmable ?? '—'}</div>
                  <div className="space-y-1">
                    {Object.entries(by).map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="truncate">{k}</span><span className="text-foreground-muted">{v}</span></div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {sel?.kind === 'port' && (() => {
              const h = (sel.item as Record<string, boolean>) || health;
              return (
                <div className="space-y-2 text-sm">
                  {Object.entries(h).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span>{k}</span>
                      <Badge tone={v ? 'success' : 'warning'} variant="outline">{v ? '通' : '不通'}</Badge>
                    </div>
                  ))}
                </div>
              );
            })()}
            {sel?.kind === 'flow' && (() => {
              const f = (sel.item as Flow) || flowItems[0];
              return (
                <div className="space-y-3 text-sm">
                  <div className="break-all"><span className="text-foreground-muted">名称：</span>{f?.name}</div>
                  <div><span className="text-foreground-muted">预估：</span>{f?.estimate || '—'}</div>
                  <div><span className="text-foreground-muted">置信度：</span>{f?.confidence || '—'}</div>
                  <div><span className="text-foreground-muted">阶段：</span>{f?.stage || '—'}</div>
                </div>
              );
            })()}
          </Sheet.Body>
        </Sheet.Content>
      </Sheet.Root>
    </PageLayout>
  );
}

export const xgConsoleViewRuntime = defineViewRuntime(xgConsoleViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgConsoleMainPanel },
});
