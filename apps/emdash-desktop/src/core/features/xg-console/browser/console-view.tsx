// [XG 2026-11-19] 中控台在 Windows 客户端上用，localhost 指客户端自己 ⇒ 默认走服务端 LAN IP，
// 可用 localStorage['xg.dotBase'] 覆盖（例如 http://192.168.1.5:8900）。
const XG_DOT_BASE = (() => {
  try {
    const o = localStorage.getItem('xg.dotBase');
    if (o) return o.replace(/\/$/, '');
  } catch {}
  return 'http://192.168.15.195:8900';
})();

// [XG-CUSTOM 2026-11-17] 中控台：照 emdash 原生骨架（PageLayout + CardGrid + CollectionView + Sheet）
//   - 数据只读 /v1/dot/status（票 / 决策 / 流 / 端口 / AF），不在渲染进程存副本
//   - 第一层：4 张概览卡 + 2×2 四张卡片；第二层：点一行 → 右侧 Sheet 看全量
import { useCallback, useEffect, useState } from 'react';
import { PageLayout, CollectionView } from '@emdash/ui/react/patterns';
import { Badge, Button, Input, MicroLabel, Sheet } from '@emdash/ui/react/primitives';
import { CardGrid, CardGridItem, EmptyState } from '@emdash/ui/react/components';
import { XgConsoleIcon } from './icon';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xgConsoleViewDef } from '../contributions/views';

type Ticket = {
  sid?: string; id?: string; title?: string; stage?: string; owner?: string;
  age_s?: number; closed?: number;
  pm?: string;
  kw?: string;
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
      let _l06: any = null;
      try {
        const r6 = await fetch(`${XG_DOT_BASE}/v1/dot/l06`, { cache: 'no-store' });
        if (r6.ok) _l06 = await r6.json();
      } catch { /* 拿不到就不显示 */ }
      const r = await fetch(`${XG_DOT_BASE}/v1/dot/status`, { cache: 'no-store' });
      const _sd: any = await r.json();
      setD({ ...(_sd || {}), l06: _l06 }); setErr(null);
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

          {/* [XG 2026-11-19] L0.6 触口 → M 层覆盖率（防退化看得见） */}
          <div className="mt-3 flex items-center gap-2 text-xs">
            <MicroLabel>M 层覆盖</MicroLabel>
            <Badge tone={((d as any)?.l06?.pct ?? 0) >= 55 ? 'success' : 'warning'} variant="outline">
              {((d as any)?.l06?.covered ?? '—')}/{(d as any)?.l06?.total ?? '—'}
              （{((d as any)?.l06?.pct ?? '—')}%）
            </Badge>
            <span className="text-foreground-muted">
              缺口 {((d as any)?.l06?.gap ?? '—')} 个触口未落 M 层
            </span>
          </div>
          <div className="mt-1 text-[11px] text-foreground-muted">
            方法论来自 @人月聊IT v9 / Apache-2.0（sharptoolbox/ontology_modeling_framework @eed15dc）
          </div>

          {/* [XG 2026-11-20] 总管看板入口：票 / 任务书 / 闸门 / 巡检，一屏摘要；详情点开独立看板 */}
          <MasterBoardStrip />
          <AttentionAndSkills />
          <CodeOntologyCard />

          {/* [XG 2026-11-18] 配方区：/v1/dot/status 的 recipes（automation-everything 等） */}
          <div className="mt-4 rounded-lg border border-border-subtle p-3">
            <MicroLabel>配方（可跑，不进端口）</MicroLabel>
            {((d as any)?.recipes ?? []).length === 0 ? (
              <div className="pt-1 text-xs text-foreground-muted">暂无配方</div>
            ) : (
              <div className="flex flex-col gap-1 pt-1">
                {((d as any)?.recipes ?? []).map((r: any) => (
                  <div key={r.name} className="flex items-center gap-2 text-xs">
                    <Badge tone="neutral" variant="outline">{r.name}</Badge>
                    <span className="truncate text-foreground-muted">{(r.flows ?? []).join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                          {(t as any).pm ? (
                            <span className="text-[11px] text-foreground-muted">
                              组合 {(t as any).pm}{(t as any).kw ? ` · ${(t as any).kw}` : ''}
                            </span>
                          ) : null}
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
      <CardsPanel />
      <GraphPanel />
    </PageLayout>
  );
}


type DecOpt = { key: string; label: string; route?: unknown };
type DecField = { name: string; label?: string; type?: string; options?: string[]; placeholder?: string };
type DecCard = { id: string; kind?: string; touchpoint?: string; question?: string; options?: DecOpt[]; fields?: DecField[] };


type MasterBrief = {
  ok?: boolean;
  counts?: { ask?: number; working?: number; stale?: number; blocked?: number; done?: number; needs_spec?: number };
  paused?: { paused?: boolean; reason?: string };
  patrol?: { state?: string; age_s?: number | null; woke?: boolean; changes?: string[] };
  schedule?: { next_in_s?: number; result?: string };
  ontology?: { ok?: boolean; grounded?: number; total?: number; reportable?: boolean };
};

const PATROL_LABEL: Record<string, string> = {
  quiet: '没变化 · 不叫醒', changed: '有变化 · 已叫醒', paused: '已暂停',
  stale: '巡检超时', unknown: '还没跑过',
};


/** [XG 2026-11-20] 注意力（只指针）+ 技能 L0：中控台看"谁让我干了什么 / 有哪些技能"。 */
function AttentionAndSkills() {
  const [a, setA] = useState<any>(null);
  const [k, setK] = useState<any>(null);
  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${XG_DOT_BASE}/v1/dot/attention`, { cache: 'no-store' }),
        fetch(`${XG_DOT_BASE}/v1/dot/skills`, { cache: 'no-store' }),
      ]);
      if (r1.ok) setA(await r1.json());
      if (r2.ok) setK(await r2.json());
    } catch { /* 不通就不显示 */ }
  }, []);
  useEffect(() => {
    void load();
    const h = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(h);
  }, [load]);
  if (!a?.ok && !k?.ok) return null;
  const bots = Object.entries(a?.bots ?? {}) as [string, any[]][];
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <MicroLabel>注意力（指针）</MicroLabel>
          <Badge tone="success" variant="outline">{a?.total ?? 0} 条</Badge>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          {bots.slice(0, 4).map(([bot, rows]) => (
            <div key={bot}>
              <span className="text-foreground-muted">{bot}</span>
              <span className="ml-2">{rows[0]?.worker ?? '—'} · {rows[0]?.summary ?? ''}</span>
            </div>
          ))}
          {!bots.length && <div className="text-foreground-muted">还没有注意力记录</div>}
        </div>
        <div className="mt-1 text-[11px] text-foreground-muted">正文留在请求方 bot，这里只留指针</div>
      </div>
      <div className="rounded-lg border border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <MicroLabel>技能 L0</MicroLabel>
          <Badge tone="success" variant="outline">{k?.count ?? 0} 个</Badge>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          {(k?.items ?? []).slice(0, 4).map((it: any) => (
            <div key={it.ref} className="truncate">{it.ref.replace('skill:', '')}</div>
          ))}
          {!k?.count && <div className="text-foreground-muted">L0 空（跑 xg_skills_l0.py --index）</div>}
        </div>
        <div className="mt-1 text-[11px] text-foreground-muted">只给名字+一句话，正文按需 load</div>
      </div>
    </div>
  );
}


/** [XG 2026-11-20] 代码↔本体覆盖：未归属清单（每次提交后由钩子刷新）。 */
function CodeOntologyCard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${XG_DOT_BASE}/v1/dot/codeindex`, { cache: 'no-store' });
        if (r.ok) setD(await r.json());
      } catch { /* 不通就不显示 */ }
    };
    void load();
    const h = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(h);
  }, []);
  if (!d?.ok) return null;
  const cov = Number(d.coverage ?? 0);
  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MicroLabel>代码↔本体</MicroLabel>
        <Badge tone={cov >= 50 ? 'success' : cov >= 10 ? 'warning' : 'danger'} variant="outline">
          已归属 {cov}%
        </Badge>
        <span className="text-xs text-foreground-muted">
          {d.total} 个后端文件 · 未归属 {d.orphan}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        {(d.top ?? []).slice(0, 5).map((f: any) => (
          <div key={f.file} className="flex justify-between gap-2">
            <span className="truncate">{f.file}</span>
            <span className="shrink-0 text-foreground-muted">{f.lines} 行</span>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[11px] text-foreground-muted">
        post-commit 钩子每提交刷新；补 `impl:` 到本体即减少未归属
      </div>
    </div>
  );
}

/** [XG 2026-11-20] 中控台里的总管摘要：只读 /v1/dot/board；完整看板在 /v1/dot/board.html。 */
function MasterBoardStrip() {
  const [b, setB] = useState<MasterBrief | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${XG_DOT_BASE}/v1/dot/board`, { cache: 'no-store' });
      if (r.ok) setB(await r.json());
    } catch { /* 看板不通不影响主面板 */ }
  }, []);
  useEffect(() => {
    void load();
    const h = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(h);
  }, [load]);
  if (!b?.ok) return null;
  const c = b.counts ?? {};
  const p = b.patrol ?? {};
  const paused = Boolean(b.paused?.paused);
  const tone = paused || p.state === 'stale' ? 'warning' : 'success';
  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MicroLabel>总管看板</MicroLabel>
        <Badge tone={tone} variant="outline">{paused ? '已暂停' : '在岗'}</Badge>
        <span className="text-xs text-foreground-muted">
          等你定 {c.ask ?? 0} · 进行 {c.working ?? 0} · 停滞 {c.stale ?? 0} · 受阻 {c.blocked ?? 0} · 结束 {c.done ?? 0} · 本体 {b.ontology?.grounded ?? 0}/{b.ontology?.total ?? 0} · {b.ontology?.reportable ? '报得准' : '本体有缺口'}
        </span>
        <Button size="sm" variant="ghost" onClick={() => window.open(`${XG_DOT_BASE}/v1/dot/board.html`, '_blank')}>
          打开完整看板
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-foreground-muted">
        巡检 {PATROL_LABEL[p.state ?? 'unknown'] ?? p.state} · {p.age_s == null ? '—' : `${p.age_s}s`} 前
        {paused && b.paused?.reason ? ` · 暂停原因：${b.paused.reason}` : ''}
        {b.schedule?.next_in_s ? ` · 6h 保底 ${Math.round(b.schedule.next_in_s / 60)} 分钟后` : ''}
      </div>
      {p.woke && (p.changes ?? []).length > 0 ? (
        <div className="mt-1 text-[11px] text-foreground-muted">这次发现：{(p.changes ?? []).slice(0, 3).join(' / ')}</div>
      ) : null}
    </div>
  );
}

/** [XG-CUSTOM 2026-11-18] 待决卡面板：卡是数据，控件按 kind/field.type 分派（原生 Button/Input）。 */
function CardsPanel() {
  const [cards, setCards] = useState<DecCard[]>([]);
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({});
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${XG_DOT_BASE}/v1/dot/cards?status=pending`, { cache: 'no-store' });
      const d = await r.json();
      setCards(Array.isArray(d?.cards) ? d.cards : []);
    } catch { /* 网络抖动：保留上一次的卡 */ }
  }, []);
  useEffect(() => {
    void load();
    const h = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(h);
  }, [load]);
  const decide = async (id: string, key: string, data?: Record<string, string>) => {
    const tail = data ? `data=${encodeURIComponent(JSON.stringify(data))}` : `key=${encodeURIComponent(key)}`;
    try { await fetch(`${XG_DOT_BASE}/v1/dot/cards/decide?id=${encodeURIComponent(id)}&${tail}`); } catch { /* 失败就留在面板上 */ }
    void load();
  };
  const setField = (id: string, name: string, v: string) =>
    setVals((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [name]: v } }));
  if (!cards.length) return null;
  return (
    <div className="space-y-3">
      <MicroLabel>待决卡 {cards.length}</MicroLabel>
      {cards.map((c) => (
        <div key={c.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs text-foreground-muted">{c.touchpoint || '—'} · {c.kind || 'clarify'}</div>
          <div className="text-sm">{c.question}</div>
          {c.fields && c.fields.length > 0 ? (
            <div className="space-y-2">
              {c.fields.map((f) => (
                <div key={f.name} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-foreground-muted">{f.label || f.name}</span>
                  {f.type === 'select' ? (
                    <select
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={vals[c.id]?.[f.name] || ''}
                      onChange={(e) => setField(c.id, f.name, e.target.value)}
                    >
                      <option value="">请选择</option>
                      {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <Input
                      value={vals[c.id]?.[f.name] || ''}
                      placeholder={f.placeholder || ''}
                      onChange={(e) => setField(c.id, f.name, e.target.value)}
                    />
                  )}
                </div>
              ))}
              <Button onClick={() => void decide(c.id, '', vals[c.id] || {})}>提交</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(c.options || []).map((o) => (
                <Button key={o.key} onClick={() => void decide(c.id, o.key)}>{o.label}</Button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const xgConsoleViewRuntime = defineViewRuntime(xgConsoleViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgConsoleMainPanel },
});


/** [XG 2026-11-18] 系统图面板：读标准产物 scene.json（唯一真源）。
 *  只展示四带与节点/边数；点「打开 3D」用系统默认浏览器看 docs/系统图 的 html。 */
function GraphPanel() {
  const [g, setG] = useState<{ nodes?: number; links?: number; layers?: { z: number; name: string }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${XG_DOT_BASE}/v1/dot/graph`, { cache: 'no-store' });
        const d = await r.json();
        if (alive) setG({ nodes: (d.nodes || []).length, links: (d.links || []).length, layers: d.layers || [] });
      } catch {
        if (alive) setG(null);
      }
    };
    void load();
    const h = window.setInterval(() => void load(), 15000);
    return () => { alive = false; window.clearInterval(h); };
  }, []);
  return (
    <div className="space-y-2 text-sm">
      <MicroLabel>系统图（scene.json · 唯一产物）</MicroLabel>
      {!g ? (
        <div className="text-xs opacity-60">读不到 /v1/dot/graph</div>
      ) : (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Badge>{g.nodes ?? 0} 节点</Badge>
            <Badge>{g.links ?? 0} 边</Badge>
            <Badge>{(g.layers || []).length} 带</Badge>
          </div>
          {(g.layers || []).map((l) => (
            <div key={l.z} className="text-xs opacity-70">z{l.z} · {l.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
