// [XG 2026-11-20] 总管视图：把 dsh-master 的四件事（看板/派活/闸门/巡检）
// 落到项我自己的票 + 本体 M1–M7 上；数据只读 8900 `/v1/dot/board`，不在渲染进程存副本。
const XG_DOT_BASE = (() => {
  try {
    const o = localStorage.getItem('xg.dotBase');
    if (o) return o.replace(/\/$/, '');
  } catch { /* 浏览器环境 */ }
  return 'http://192.168.15.195:8900';
})();

import { useCallback, useEffect, useState } from 'react';
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button, MicroLabel } from '@emdash/ui/react/primitives';
import { CardGrid, CardGridItem, EmptyState } from '@emdash/ui/react/components';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xgMasterViewDef } from '../contributions/views';

type MObj = { id?: string; name?: string; state?: string; source?: string; label?: string; why?: string };
type Gate = { id?: string; title?: string; state?: string; note?: string; produces?: string };
type Task = {
  id?: string; title?: string; owner?: string; stage?: string; bucket?: string;
  project?: string; age_s?: number; heavy?: boolean; needs_spec?: boolean; reason?: string;
  goal?: string; deliverables?: string[]; acceptance?: string[]; redlines?: string[];
  gates?: Gate[]; gate_progress?: string; gate_failed?: string | null;
  m?: Record<string, MObj>; grounded?: boolean; m_issues?: string[];
  durable?: { ok?: boolean; fields?: Record<string, MObj & { value?: unknown }> };
};
type Group = {
  project?: string; working?: number; blocked?: number; stale?: number; done?: number;
  needs_spec?: number; tasks?: Task[];
};
type Coverage = { present?: number; valid?: number; missing?: number; dangling?: number; mismatch?: number; total?: number; label?: string };
type Board = {
  ok?: boolean;
  counts?: Record<string, number>;
  groups?: Group[];
  asks?: { id?: string; question?: string; touchpoint?: string; options?: { key?: string; label?: string }[] }[];
  patrol?: { state?: string; age_s?: number | null; woke?: boolean; changes?: string[]; paused?: boolean; reason?: string; interval_s?: number };
  paused?: { paused?: boolean; reason?: string };
  ontology?: {
    ok?: boolean; total?: number; grounded?: number; ungrounded?: number; reportable?: boolean;
    models?: Record<string, number>; coverage?: Record<string, Coverage>;
    durable?: { ok?: number; total?: number; duplicate_request_ids?: string[]; coverage?: Record<string, Coverage>; real_runs?: number; real_coverage?: number };
  };
  schedule?: { pending?: number; next_in_s?: number; result?: string };
};

const STAGE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  done: 'success', working: 'info', stale: 'warning', fail: 'warning',
};

const PATROL_LABEL: Record<string, string> = {
  quiet: '没变化 · 不叫醒', changed: '有变化 · 已叫醒', paused: '已暂停',
  stale: '巡检超时', unknown: '还没跑过',
};

function fmtAge(s?: number | null) {
  if (s === undefined || s === null) return '—';
  const n = Math.max(0, Math.round(s));
  if (n < 90) return `${n}s`;
  if (n < 5400) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

function Row({ primary, secondary, right }: { primary: React.ReactNode; secondary?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{primary}</div>
        {secondary !== undefined && <div className="truncate text-xs text-foreground-muted">{secondary}</div>}
      </div>
      {right !== undefined && <div className="shrink-0 text-xs text-foreground-muted">{right}</div>}
    </div>
  );
}

function mOk(t: Task) {
  return Object.values(t.m ?? {}).filter((v) => v.state === 'ok').length;
}

export function XgMasterMainPanel() {
  const [d, setD] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${XG_DOT_BASE}/v1/dot/board`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setD(await r.json());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const h = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(h);
  }, [load]);

  const paused = Boolean(d?.paused?.paused);
  const togglePause = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${XG_DOT_BASE}/v1/dot/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paused ? { action: 'resume' } : { action: 'pause', reason: '中控台' }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const c = d?.counts ?? {};
  const o = d?.ontology ?? {};
  const p = d?.patrol ?? {};
  const coverage = Object.entries(o.coverage ?? {});
  const pct = o.total ? Math.round(((o.grounded ?? 0) * 100) / o.total) : 0;
  const toggle = (id?: string) => {
    if (!id) return;
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  };

  return (
    <PageLayout>
      <PageLayout.Content maxWidth="4xl">
        <PageLayout.Header
          title="总管"
          description="票 / 任务书 / 闸门 / 巡检 · 本体 M1–M7 · 只读 /v1/dot/board"
          sticky
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={paused ? 'warning' : 'success'} variant="outline">{paused ? '已暂停' : '在岗'}</Badge>
              <Button size="sm" variant="ghost" onClick={() => void togglePause()} disabled={busy}>
                {paused ? '恢复' : '暂停'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.open(`${XG_DOT_BASE}/v1/dot/board.html`, '_blank')}>
                完整看板
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void load()}>
                刷新
              </Button>
            </div>
          }
        />

        {err && <div className="py-2 text-xs text-foreground-danger">看板接口不通：{err}</div>}

        <CardGrid className="mt-3">
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>等你定</MicroLabel><div className="text-2xl font-semibold">{c.ask ?? 0}</div><div className="truncate text-xs text-foreground-muted">点一下就是回答</div></div></CardGridItem>
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>进行中</MicroLabel><div className="text-2xl font-semibold">{c.working ?? 0}</div><div className="truncate text-xs text-foreground-muted">在跑</div></div></CardGridItem>
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>停滞</MicroLabel><div className="text-2xl font-semibold">{c.stale ?? 0}</div><div className="truncate text-xs text-foreground-muted">超过 6h 没动静</div></div></CardGridItem>
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>受阻</MicroLabel><div className="text-2xl font-semibold">{c.blocked ?? 0}</div><div className="truncate text-xs text-foreground-muted">失败 / 打回</div></div></CardGridItem>
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>已结束</MicroLabel><div className="text-2xl font-semibold">{c.done ?? 0}</div><div className="truncate text-xs text-foreground-muted">挂本体 {c.done_grounded ?? 0} · 未挂 {c.done_ungrounded ?? 0}</div></div></CardGridItem>
          <CardGridItem><div className="flex flex-col gap-1"><MicroLabel>本体挂上</MicroLabel><div className="text-2xl font-semibold">{o.grounded ?? 0}/{o.total ?? 0}</div><div className="truncate text-xs text-foreground-muted">{pct}% · Durable {o.durable?.ok ?? 0}/{o.durable?.total ?? 0}</div></div></CardGridItem>
        </CardGrid>

        <div className="mt-4 rounded-lg border border-border-subtle p-3">
          <div className="flex flex-wrap items-center gap-2">
            <MicroLabel>本体 M1–M7</MicroLabel>
            <Badge tone={o.ok ? 'success' : 'warning'} variant="outline">{o.ok ? '已连' : '未连'}</Badge>
            <Badge tone={o.reportable ? 'success' : 'warning'} variant="outline">{o.reportable ? '报得准' : '有缺口'}</Badge>
            <span className="text-xs text-foreground-muted">
              M1 {o.models?.m1 ?? '—'} · M2 {o.models?.m2 ?? '—'} · M3 {o.models?.m3 ?? '—'} · M5 {o.models?.m5 ?? '—'} · M6 {o.models?.m6 ?? '—'} · M7 {o.models?.m7 ?? '—'} · MU {o.models?.mu ?? '—'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {coverage.map(([k, v]) => {
              const bad = (v.missing ?? 0) + (v.dangling ?? 0) + (v.mismatch ?? 0);
              return (
                <Badge key={k} tone={bad ? 'warning' : 'success'} variant="outline">
                  {v.label ?? k} {v.valid ?? 0}/{v.total ?? 0}
                  {bad ? ` · 缺 ${v.missing ?? 0}` : ''}
                </Badge>
              );
            })}
          </div>
          <div className="mt-1 text-[11px] text-foreground-muted">
            M2 由 M6 step 推导；M1 缺的是老票的 objId。报得准 = M1–M6 + Pi Durable 都能落到模型，看板只把 grounded 当准数。
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-foreground-muted">
            <Badge tone={(o.durable?.ok ?? 0) === (o.durable?.total ?? 0) && (o.durable?.total ?? 0) > 0 ? 'success' : 'warning'} variant="outline">
              Pi Durable 字段 {o.durable?.ok ?? 0}/{o.durable?.total ?? 0} · 真实 {o.durable?.real_runs ?? 0}/{o.durable?.total ?? 0}（{Math.round((o.durable?.real_coverage ?? 0) * 100)}%）
            </Badge>
            {Object.entries(o.durable?.coverage ?? {}).map(([k, v]) => (
              <Badge key={k} tone={(v.missing ?? 0) + (v.mismatch ?? 0) > 0 ? 'warning' : 'success'} variant="outline">
                {v.label ?? k} {v.valid ?? 0}/{v.total ?? 0}
              </Badge>
            ))}
            {(o.durable?.duplicate_request_ids ?? []).length > 0 && (
              <Badge tone="warning" variant="outline">重复请求号 {o.durable?.duplicate_request_ids?.length}</Badge>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle p-3">
          <MicroLabel>巡检</MicroLabel>
          <Badge tone={p.state === 'changed' ? 'warning' : p.state === 'paused' || p.state === 'stale' ? 'warning' : 'success'} variant="outline">
            {PATROL_LABEL[p.state ?? 'unknown'] ?? p.state}
          </Badge>
          <span className="text-xs text-foreground-muted">
            {fmtAge(p.age_s)} 前 · 每 {Math.round((p.interval_s ?? 600) / 60)} 分钟
            {d?.schedule?.pending ? ` · 6h 待看 ${d.schedule.pending}` : ''}
          </span>
          {p.paused && <span className="text-xs text-foreground-warning">暂停原因：{p.reason ?? '—'}</span>}
        </div>

        {(d?.asks ?? []).length > 0 && (
          <div className="mt-3 rounded-lg border border-border-subtle p-3">
            <div className="flex items-center gap-2">
              <MicroLabel>等你定</MicroLabel>
              <Badge tone="warning" variant="outline">{d?.asks?.length}</Badge>
            </div>
            {(d?.asks ?? []).map((a) => (
              <Row key={a.id} primary={a.question ?? '(无问题)'} secondary={`${a.touchpoint ?? '—'} · ${a.id ?? ''}`} />
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(d?.groups ?? []).map((g) => {
            const openCount = (g.working ?? 0) + (g.stale ?? 0) + (g.blocked ?? 0);
            if (!openCount && !g.needs_spec) return null;
            return (
              <section key={g.project} className="flex max-h-[28rem] flex-col rounded-xl border border-border-subtle bg-surface">
                <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                  <span className="truncate text-sm font-medium">{g.project}</span>
                  <span className="shrink-0 text-xs text-foreground-muted">进行 {g.working ?? 0} · 停滞 {g.stale ?? 0} · 受阻 {g.blocked ?? 0}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-3">
                  {(g.tasks ?? []).filter((t) => t.bucket !== 'done').map((t) => {
                    const isOpen = open.has(t.id ?? '');
                    return (
                      <div key={t.id} className="border-t border-border-subtle first:border-t-0">
                        <button type="button" className="w-full text-left" onClick={() => toggle(t.id)}>
                          <Row
                            primary={<span className="flex items-center gap-2"><Badge tone={STAGE_TONE[t.stage ?? ''] ?? 'neutral'} variant="outline">{t.stage ?? '?'}</Badge><span className="truncate">{t.title ?? '(无标题)'}</span></span>}
                            secondary={<span className="flex flex-wrap items-center gap-1"><span>{t.owner ?? '—'}</span>{t.gate_progress && <Badge tone={t.gate_failed ? 'warning' : 'success'} variant="outline">闸门 {t.gate_progress}</Badge>}<Badge tone={t.grounded ? 'success' : 'warning'} variant="outline">本体 {mOk(t)}/5</Badge>{t.durable && !t.durable.ok && <Badge tone="warning" variant="outline">D {Object.values(t.durable.fields ?? {}).filter(v => v.state === 'ok').length}/5</Badge>}{t.reason && <span className="text-foreground-warning">{t.reason}</span>}</span>}
                            right={fmtAge(t.age_s)}
                          />
                        </button>
                        {isOpen && <TaskDetail t={t} />}
                      </div>
                    );
                  })}
                  {openCount === 0 && <EmptyState label="没有在跑的" />}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-3 text-[11px] text-foreground-muted">
          M7 查询 <code>QY-MASTER-BOARD</code> · MU <code>OP-MASTER-BOARD</code> · 闸门动作去完整看板
        </div>
      </PageLayout.Content>
    </PageLayout>
  );
}

function TaskDetail({ t }: { t: Task }) {
  return (
    <div className="mb-2 ml-2 space-y-1 border-l-2 border-border-subtle pl-3 text-xs">
      {t.goal && <div><span className="text-foreground-muted">目标：</span>{t.goal}</div>}
      {(t.gates ?? []).length > 0 && (
        <div>
          <div className="text-foreground-muted">闸门</div>
          {(t.gates ?? []).map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              <span>{g.state === 'passed' ? '✅' : g.state === 'failed' ? '❌' : '⏳'}</span>
              <span>{g.id} · {g.title}</span>
              {g.note && <span className="text-foreground-muted">（{g.note}）</span>}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="text-foreground-muted">本体出处</div>
        {Object.entries(t.m ?? {}).map(([f, v]) => (
          <div key={f} className="flex items-center gap-2">
            <span>{v.state === 'ok' ? '✅' : v.state === 'missing' ? '⚠️' : '❌'}</span>
            <span className="w-16 shrink-0">{v.label ?? f}</span>
            <span className="truncate">{v.name || v.id || '缺'}</span>
            <code className="text-[10px] text-foreground-muted">{v.id || '—'}</code>
            {v.source === 'derived' && <Badge tone="neutral" variant="outline">step 推导</Badge>}
          </div>
        ))}
      </div>
      {t.durable?.fields && (
        <div>
          <div className="text-foreground-muted">Pi Durable 提交面</div>
          {Object.entries(t.durable.fields).map(([f, v]) => (
            <div key={f} className="flex items-center gap-2">
              <span>{v.state === 'ok' ? '✅' : v.state === 'missing' ? '⚠️' : '❌'}</span>
              <span className="w-16 shrink-0">{v.label ?? f}</span>
              <span className="truncate">{String(v.value ?? '—')}</span>
              {v.why && <span className="text-foreground-muted">{v.why}</span>}
            </div>
          ))}
        </div>
      )}
      {(t.m_issues ?? []).length > 0 && (
        <div className="text-foreground-warning">缺口：{(t.m_issues ?? []).join('；')}</div>
      )}
    </div>
  );
}

export const xgMasterViewRuntime = defineViewRuntime(xgMasterViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: XgMasterMainPanel },
});
