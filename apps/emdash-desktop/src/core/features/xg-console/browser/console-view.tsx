// [XG-CUSTOM 2026-11-17] 中控台：照 emdash 原生骨架（PageLayout + CardGrid + CollectionView + Sheet）
//   - 数据只读 /v1/dot/status（票 / 决策 / 流 / 端口 / AF），不在渲染进程存副本
//   - 第一层：4 张概览卡 + 2×2 四张卡片；第二层：点一行 → 右侧 Sheet 看全量
import { useCallback, useEffect, useState } from 'react';
import { PageLayout, CollectionView } from '@emdash/ui/react/patterns';
import { Badge, Button, MicroLabel, Sheet } from '@emdash/ui/react/primitives';
import { CardGrid, CardGridItem, EmptyState } from '@emdash/ui/react/components';
import { XgConsoleIcon } from './icon';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xgConsoleViewDef } from '../contributions/views';

type Ticket = {
  sid?: string; id?: string; title?: string; stage?: string; owner?: string;
  age_s?: number; closed?: number;
};
type Route = { ts: number; lane: string; task: string; why?: string; outcome?: string | null };
type Flow = { name: string; estimate?: string; confidence?: string; stage?: string };
/** [XG-CUSTOM 2026-11-17] Kaneo 后台链 —— 服务端 `_xg_kaneo_chain_status()` 给的**进程内**状态。
 *  `enabled` = 开关（env）；`thread` = **线程真的在**（Python 线程名）。
 *  🔴 **两者必须分开看**："关着"不是故障；**`enabled && !thread` 才是真警报**。 */
type Chain = {
  loaded?: boolean; thread?: boolean; enabled?: boolean; mode?: string;
  interval?: number; scans?: number; last_scan?: string | null;
};
type Kaneo = { in_window?: boolean | null; chains?: Record<string, Chain> };
type Status = {
  ok?: boolean; state?: string; working?: Ticket[]; tickets?: Ticket[]; routing?: Route[];
  flows?: (Flow | string)[]; health?: Record<string, boolean>;
  kaneo?: Kaneo;
  af?: { ok?: boolean; unanswered_effective?: number; over_count?: number; auto_confirmable?: number; by_workspace?: Record<string, number> };
};

const LANE_TONE: Record<string, 'success' | 'info' | 'neutral'> = { r0: 'success', fast: 'info', d1: 'neutral' };
const STAGE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  done: 'success', working: 'info', stale: 'warning', uncertain: 'warning',
};

function fmtAge(s?: number) {
  if (s === undefined || s === null) return '—';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function Row({ primary, secondary, right }: { primary: React.ReactNode; secondary?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{primary}</div>
        {secondary !== undefined && <div className="truncate text-xs text-foreground-muted">{secondary}</div>}
      </div>
      {right !== undefined && <div className="shrink-0 text-xs text-foreground-muted">{right}</div>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex h-72 flex-col rounded-xl border border-border-subtle bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-foreground-muted">{count}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3">{children}</div>
    </section>
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
      const r = await fetch('http://localhost:8900/v1/dot/status', { cache: 'no-store' });
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
  // [XG-CUSTOM 2026-11-17] Kaneo 三条后台链：enabled 是开关、thread 是**线程真的在**
  //  —— 分开放，"关着"不是故障；**enabled && !thread 才是真警报**（开关开着、线程没了）。
  const kc = d?.kaneo?.chains ?? {};
  const KANEO_CHAINS: { key: string; label: string }[] = [
    { key: 'dispatch', label: '派活' },
    { key: 'autoconsume', label: '交接消费' },
    { key: 'image_worker', label: '图片线' },
  ];
  const kaneoOn = KANEO_CHAINS.filter((c) => kc[c.key]?.enabled);
  const kaneoAlive = kaneoOn.filter((c) => kc[c.key]?.thread).length;
  const kaneoWindowOff = d?.kaneo?.in_window === false;
  /** 一条链的标记：✓ 线程在 / ✗ **开关开着但线程不在**（真警报）/ · 关着（不是故障） */
  const kaneoMark = (key: string): string => {
    const ch = kc[key];
    return ch?.thread ? '✓' : ch?.enabled ? '✗' : '·';
  };
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

          {err && <div className="py-2 text-xs text-foreground-danger">状态接口不通：{err}</div>}

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
            <CardGridItem>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <MicroLabel>Kaneo 链</MicroLabel>
                <div className="text-2xl font-semibold">{kaneoAlive}/{kaneoOn.length}</div>
                <div className="truncate text-xs text-foreground-muted">
                  {kaneoWindowOff ? '窗口外(不派活) · ' : ''}
                  {KANEO_CHAINS.map((c) => `${c.label}${kaneoMark(c.key)}`).join(' · ')}
                </div>
              </div>
            </CardGridItem>
          </CardGrid>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="在派工" count={working.length}>
              {working.length === 0 ? <EmptyState title="没有正在跑的票" /> : working.map((t, i) => (
                <div key={`w-${i}`} role="button" tabIndex={0} onClick={() => setSel({ kind: 'ticket', item: t })} className="cursor-pointer hover:bg-surface-hover">
                  {(() => {
                    const lv = (d?.live ?? []).find((x) => String(x.sid || '') === String(t.sid || ''));
                    return (
                      <Row primary={t.owner || '?'} secondary={
                        <span className="flex flex-col gap-0.5">
                          <span className="truncate">{t.title || '(无标题)'}</span>
                          {lv?.tool ? <span className="text-[11px] text-foreground-muted">正在调用 {lv.tool} · {fmtAge(lv.age_s)}</span> : null}
                        </span>
                      } right={fmtAge(t.age_s)} />
                    );
                  })()}
                </div>
              ))}
            </Section>

            <Section title="最近票" count={tickets.length}>
              {tickets.length === 0 ? <EmptyState title="还没有票" /> : tickets.slice(0, 10).map((t, i) => (
                <div key={`t-${i}`} role="button" tabIndex={0} onClick={() => setSel({ kind: 'ticket', item: t })} className="cursor-pointer hover:bg-surface-hover">
                  <Row primary={<span className="flex items-center gap-2"><Badge tone={STAGE_TONE[t.stage || ''] || 'neutral'} variant="outline">{t.stage || '?'}</Badge><span className="truncate">{t.owner || '?'}</span></span>} secondary={t.title || '(无标题)'} right={fmtAge(t.age_s)} />
                </div>
              ))}
            </Section>

            <Section title="花名册" count={(d?.bots ?? []).length}>
              {(() => {
                const bots = d?.bots ?? [];
                if (bots.length === 0) return <EmptyState title="没有登记 bot" />;
                const tierOf = (t?: string) => (t === 'light' ? '4B' : t === 'heavy' ? '27B' : 'auto');
                const cnt = (k: string) => bots.filter((b) => tierOf(b.tier) === k).length;
                const trHi = bots.filter((b) => b.translate === 'high').length;
                return (
                  <CardGrid className="grid-cols-2 lg:grid-cols-4">
                    <CardGridItem>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <MicroLabel>走 4B</MicroLabel>
                        <div className="text-xl font-semibold">{cnt('4B')}</div>
                        <div className="truncate text-xs text-foreground-muted">
                          {bots.filter((b) => tierOf(b.tier) === '4B').map((b) => b.name).join(' · ')}
                        </div>
                      </div>
                    </CardGridItem>
                    <CardGridItem>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <MicroLabel>走 27B</MicroLabel>
                        <div className="text-xl font-semibold">{cnt('27B')}</div>
                        <div className="truncate text-xs text-foreground-muted">
                          {bots.filter((b) => tierOf(b.tier) === '27B').map((b) => b.name).join(' · ')}
                        </div>
                      </div>
                    </CardGridItem>
                    <CardGridItem>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <MicroLabel>翻译先 27B</MicroLabel>
                        <div className="text-xl font-semibold">{trHi}</div>
                        <div className="truncate text-xs text-foreground-muted">
                          {bots.filter((b) => b.translate === 'high').map((b) => b.name).join(' · ') || '—'}
                        </div>
                      </div>
                    </CardGridItem>
                    <CardGridItem>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <MicroLabel>合计</MicroLabel>
                        <div className="text-xl font-semibold">{bots.length}</div>
                        <div className="truncate text-xs text-foreground-muted">tier 来自 bots/registry.json</div>
                      </div>
                    </CardGridItem>
                  </CardGrid>
                );
              })()}
            </Section>

            <Section title="最近决策" count={routing.length}>
              {routing.length === 0 ? <EmptyState title="还没有决策记录" /> : routing.slice(0, 10).map((r, i) => (
                <div key={`r-${i}`} role="button" tabIndex={0} onClick={() => setSel({ kind: 'route', item: r })} className="cursor-pointer hover:bg-surface-hover">
                  <Row primary={<span className="flex items-center gap-2"><Badge tone={LANE_TONE[r.lane] || 'neutral'} variant="outline">{r.lane}</Badge><span className="truncate">{r.task}</span></span>} secondary={r.why || ''} right={r.outcome || '—'} />
                </div>
              ))}
            </Section>

            <Section title="中控台流" count={flowItems.length}>
              {flowItems.length === 0 ? <EmptyState title="没有登记流" /> : flowItems.map((f, i) => (
                <div key={`f-${i}`} role="button" tabIndex={0} onClick={() => setSel({ kind: 'flow', item: f })} className="cursor-pointer hover:bg-surface-hover">
                  <Row primary={f.name} secondary={`${f.estimate || '—'} · ${f.confidence || '—'}`} />
                </div>
              ))}
            </Section>
            <Section title="Kaneo 后台链" count={kaneoOn.length}>
              {KANEO_CHAINS.map((c) => {
                const ch = kc[c.key];
                const tone = ch?.thread ? 'success' : ch?.enabled ? 'warning' : 'neutral';
                const txt = ch?.thread ? '线程在跑' : ch?.enabled ? '⚠️ 开着但线程不在' : '已关闭';
                return (
                  <div key={c.key} className="flex min-w-0 items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{c.label}</div>
                      <div className="truncate text-xs text-foreground-muted">
                        {txt} · mode={ch?.mode || '?'} · 间隔 {ch?.interval ?? '?'}s
                        {typeof ch?.scans === 'number' ? ` · 已扫 ${ch.scans} 轮` : ''}
                        {ch?.last_scan ? ` · 最近 ${String(ch.last_scan).slice(11, 19)}` : ''}
                      </div>
                    </div>
                    <Badge tone={tone} variant="outline">
                      {ch?.thread ? 'live' : ch?.enabled ? 'missing' : 'off'}
                    </Badge>
                  </div>
                );
              })}
              {kaneoWindowOff ? (
                <div className="py-2 text-xs text-foreground-muted">
                  当前不在派活窗口（XG_ALWAYS_ON_WINDOW=00:00-08:00）—— 白天跳过是设计，不是故障
                </div>
              ) : null}
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
