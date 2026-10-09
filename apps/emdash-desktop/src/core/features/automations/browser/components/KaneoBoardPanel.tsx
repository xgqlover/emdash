// [XG-CUSTOM 2026-10-08] 「自动化」视图的 **Kaneo 看板** 面板 —— 现在是**系统图浏览**。
//
// 用户原话：「我不是加了个能画工作流图能力，**能在 emdash 可以看**吗」
//
// ## 为什么从"卡列表"改成"图浏览"
// 第一版我列的是**平的 200 张卡**，用户当场指出「还是两个不同的东西拼一起」——
// 那是实话：那个列表既没有动作、又比 Kaneo 自己的看板难看，纯属重复。
// 现在改成：**Kaneo 概览（一行数字 + 列徽章）+ Archify 图（可交互，直接在这里看）**。
//
// ## [XG-CUSTOM 2026-10-09] 再进一步：加「**全流程一屏**」（`PipelineStrip`）
//
// 用户原话：「**能让我有 emdash 一个平台上就能控制好这个所有流程的**」。
// 光有"卡数 + 图"不够 —— **看不到出图引擎活不活 / 图片线 worker 开没开 /
// 有没有卡卡在冷却里**，等于只看了一半流程。所以最上面加了一条状态条，
// 数据源 = `xiangwo-agent/kaneo_board.py::_pipeline()`（**只读探活，打开面板不占 GPU**）。
//
// 🔴 **三态显示，不是布尔**：活 / 明确死 / **查不到**（`ok:false`、`busy:null`）。
//    **绝不许把"查不到"画成"正常"** —— 本项目踩过 6 次「空 ≠ 失败」。
// 🔴 **缩略图走真壳的 `/v1/files/`**（`<img src>`）—— 和 `<iframe>` 那条一样，
//    **不通过 IPC 搬图**（产物动辄 1 MB）。
//
// ## [XG-CUSTOM 2026-10-09] 再加「**动作面**」（`ImageQueue`）：建卡 + 一键开工
//
// 光"看得见"还不够，用户要的是**控住**。所以再给：
//   · 「＋ 建卡」：选项目 + 标题 + 提示词 + 画幅比 ⇒ 落到 `kaneo_board.py act`，
//     **自动贴「图片线」label 并填好字段** ⇒ worker 下一轮就捡它出图
//   · 「开工」：**点名**一张卡 ⇒ **后台**起一轮出图（点完立刻返回）
//
// 🔴 两条硬约束（都写进 `main/host/window.ts::kaneoActCall` 的注释）：
//   ① 桥接的 `spawn` **没有超时** ⇒ 出图**必须后台化**，结果靠刷新看 `worker.last`
//   ② 桥接**解析失败不报错、而是把 stdout 原文当字符串返回** ⇒ `describeAct()` 先判类型，
//      **绝不直接读 `.ok`**（那会得到 `undefined`，正好落进「空 ≠ 失败」）
//
// ## 图怎么进来（**绝不走 IPC 传大文件**）
// `kaneo_board.py` 顺手返回图清单（含**已 URL 编码**的地址），面板用 `<iframe src>` 指到
// 8900 的 `/xg/diagram/<名字>` —— 那个路由已建好并实测（200 / 772KB）。
// ⚠️ 单图 700+ KB，**不要**通过 host 桥接把 HTML 文本搬进来（会撑爆 IPC）。
//
// ## 安全姿态（与 `html-renderer.tsx` 一致）
// `sandbox="allow-scripts"` **不带** `allow-same-origin` ⇒ iframe 是**不透明源**：
// 脚本能跑（图要 JS），但**读不到宿主的 cookie / localStorage**。
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button, toast } from '@emdash/ui/react/primitives';
import { ExternalLink, Image as ImageIcon, LayoutGrid, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  KaneoActInput,
  KaneoActResult,
  KaneoBoardResult,
  KaneoPipeline,
} from '@core/primitives/desktop-host/api/host-contract';
import { kaneoAct, kaneoBoard } from '@core/primitives/desktop-host/browser/host-client';
import { cn } from '@core/primitives/styling/browser/cn';

/** Kaneo 的列 slug → 人话（未知 slug 原样显示，别瞎猜） */
const COLUMN_LABEL: Record<string, string> = {
  'to-do': '待办',
  'in-progress': '进行中',
  'in-review': '评审中',
  done: '已完成',
  archived: '已归档',
  backlog: '积压',
};

function relTime(iso: string): string {
  if (!iso) return '—';
  const diff = Math.floor(Date.now() / 1000) - Math.floor(Date.parse(iso) / 1000);
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function humanSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

// ── [XG-CUSTOM 2026-10-09] 「全流程一屏」────────────────────────────────────────
//
// 用户原话：「**能让我有 emdash 一个平台上就能控制好这个所有流程的**」。
// 原来这个面板只有 Kaneo 概览（卡数/列/图）—— **看不到出图引擎活不活、图片线 worker
// 开没开、有没有卡卡在冷却里**，等于只看了一半。这一段把那四条链的状态摊在一屏里。
//
// 🔴 **三态，不是布尔**：`ok`（活）/ `down`（明确死）/ `unknown`（查不到）。
//    `kaneo_board.py` 那边取不到时给的是 `ok:false` / `busy:null`，**不许把"查不到"
//    画成"正常"** —— 本项目踩过 6 次「空 ≠ 失败」。

type LinkState = 'ok' | 'down' | 'unknown';

function Dot({ state }: { state: LinkState }) {
  const tone =
    state === 'ok'
      ? 'text-foreground-success'
      : state === 'down'
        ? 'text-destructive'
        : 'text-foreground-passive';
  return (
    <span className={tone} aria-hidden>
      ●
    </span>
  );
}

function Link({
  label,
  state,
  title,
  children,
}: {
  label: string;
  state: LinkState;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className="shrink-0 text-foreground-muted">{label}</span>
      <Dot state={state} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** 排活台账里那几种 `action` → 人话（未知的原样显示，**别瞎猜**） */
const DISPATCH_ACTION: Record<string, string> = {
  dispatched: '已派专家',
  skipped_r0: '判定不需要专家',
  skipped: '跳过',
  error: '失败',
};

function PipelineStrip({ p }: { p: KaneoPipeline }) {
  const { engine: e, shell: s, worker: w, dispatch: d } = p;
  return (
    <div className="border-border-subtle flex flex-col gap-3 rounded-md border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground-muted">
        <Link
          label="出图引擎"
          state={e.ok ? 'ok' : 'down'}
          title="Win 上的 ComfyUI（真出图的地方）"
        >
          {e.ok ? `ComfyUI ${e.version || '?'}` : '连不上'} · 显存 {e.vram_free_gb}/
          {e.vram_total_gb} G · 内存 {e.ram_free_gb} G
        </Link>
        <Link label="真壳" state={s.ok ? 'ok' : 'down'} title="comfy-openai :8199（单并发锁在这）">
          {s.ok ? (s.busy === null ? '忙闲未知' : s.busy ? '正在出图' : '空闲') : '连不上'} · 队列{' '}
          {s.queue_len} · 已服务 {s.served}
        </Link>
        <Link label="图片线" state={w.enabled ? 'ok' : 'down'} title="Kaneo「图片线」卡 → 自动出图">
          {w.enabled ? `已开（每 ${w.interval_s}s）` : '已关'} · 待出图 {w.todo} · 草稿 {w.drafts} ·
          冷却 {w.cooldown}/{w.cooldown_min}分
        </Link>
        <Link label="排活" state={d.enabled ? 'ok' : 'down'} title="卡进列 → 派专家">
          {d.enabled ? `已开（${d.columns || '—'}，每 ${d.interval_s}s）` : '已关'} · 队列{' '}
          {d.queued} · 已处理 {d.processed}
        </Link>
      </div>

      {d.last ? (
        <div className="text-xs text-foreground-passive">
          最近一次排活：{d.last.title} → {DISPATCH_ACTION[d.last.action] ?? d.last.action}
          {d.last.expert ? `（${d.last.expert}）` : ''} · {relTime(d.last.ts)}
        </div>
      ) : null}

      {/* 最近产物：缩略图直接来自真壳的 /v1/files/（**不必再走 IPC 传图**） */}
      {p.artifacts.length ? (
        <div className="flex flex-wrap gap-3">
          {p.artifacts.map((a) => (
            <a
              key={a.name}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-[128px] shrink-0 flex-col gap-1"
              title={`${a.name} · ${a.w}×${a.h} · ${relTime(a.mtime)}`}
            >
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                className="border-border-subtle h-[72px] w-full rounded border object-cover"
              />
              <span className="truncate text-xs text-foreground-passive">
                {a.w}×{a.h} · {humanSize(a.bytes)}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── [XG-CUSTOM 2026-10-09] 动作面（**写操作**）────────────────────────────────
//
// 用户口径：「emdash 一个平台上就能控制好这个所有流程的」。`PipelineStrip` 解决"**看得见**"，
// 这一段解决"**动得了**"：**建卡** + **一键开工**。
//
// 🔴 两条硬约束（理由见 `main/host/window.ts::kaneoActCall`）：
//   ① 桥接的 spawn **没有超时** ⇒ 出图必须**后台化**：点完**立刻返回**，结果靠刷新看 `worker.last`
//   ② 桥接**解析失败不报错、而是把 stdout 原文当字符串返回** ⇒ 必须先判类型，**别直接读 `.ok`**

type Outcome = { ok: boolean; tone: LinkState; text: string };

/** 把 `unknown` 的动作返回**显式**翻译成人话 —— 尤其"根本不是对象"那种（静默失败的温床） */
function describeAct(res: unknown): Outcome {
  if (typeof res !== 'object' || res === null) {
    return {
      ok: false,
      tone: 'down',
      text: `动作返回的**不是对象**（桥接把解析失败的原文当字符串返回了？）：${String(res).slice(0, 140)}`,
    };
  }
  const r = res as KaneoActResult;
  if (!r.ok) return { ok: false, tone: 'down', text: r.error ?? '未知错误（返回里没有 error）' };
  if (r.action === 'create_card') {
    return {
      ok: true,
      tone: 'ok',
      text: `已建卡「${r.title ?? ''}」(${r.taskId ?? '?'})：设了 ${r.fieldsSet ?? 0} 个字段${
        r.labeled ? '，已贴「图片线」label' : '，⚠️ 没贴上 label（worker 不会捡它）'
      }`,
    };
  }
  if (r.action === 'run_image') {
    return {
      ok: true,
      tone: 'ok',
      text: `已开工（后台 pid ${r.pid ?? '?'}）—— 出图约 2~4 分钟；点「刷新」看结果`,
    };
  }
  return { ok: true, tone: 'ok', text: '已完成' };
}

const FIELD_CLS =
  'w-full rounded border border-border-subtle bg-background px-2 py-1 text-sm text-foreground';

function ImageQueue({
  p,
  projectOptions,
  onChanged,
}: {
  p: KaneoPipeline;
  projectOptions: { projectId: string; name: string }[];
  onChanged: () => void;
}) {
  const w = p.worker;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    projectId: projectOptions[0]?.projectId ?? '',
    title: '',
    prompt: '',
    negative: '',
    aspectRatio: '16:9',
  });

  const run = useCallback(
    async (payload: KaneoActInput) => {
      setBusy(true);
      setOutcome(null);
      try {
        setOutcome(describeAct(await kaneoAct(payload)));
      } catch (e) {
        setOutcome({ ok: false, tone: 'down', text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
        onChanged();
      }
    },
    [onChanged]
  );

  const lastTone: LinkState = !w.last ? 'unknown' : w.last.state === 'failed' ? 'down' : 'ok';
  /** 队列里正在失败/退避的卡数（**只数明确 failed 的** —— 没记录不算失败） */
  const failedCount = w.queue.filter((c) => c.state === 'failed').length;
  /** 运行态里的 taskId → 队列里的标题（拿不到就退回 id） */
  const titleOf = (tid: string): string => {
    const hit = w.queue.find((c) => c.task_id === tid);
    if (hit) return hit.title;
    return tid || '（未知卡）';
  };
  /** **正在跑**（陈旧的不算 —— `stale` 的判据是给 pid 探活，见 worker.running 的注释） */
  const running = w.running && !w.running.stale ? w.running : null;

  return (
    <div className="border-border-subtle flex flex-col gap-3 rounded-md border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5 text-foreground-muted">
          图片线队列 {w.queue.length} 张
          {failedCount > 0 ? (
            <span className="text-destructive">· ⚠️ {failedCount} 张失败</span>
          ) : null}
          {w.last ? (
            <>
              <span>·</span>
              <Dot state={lastTone} />
              <span title={w.last.path || w.last.why}>
                最近一次：{w.last.state === 'failed' ? '失败' : '已出图'}（{relTime(w.last.at)}）
              </span>
            </>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? '收起' : '＋ 建卡'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || w.queue.length === 0}
            title={w.queue.length === 0 ? '队列里没有待出图的卡' : '把队列里最早那张卡交给 worker'}
            onClick={() => void run({ action: 'run_image', limit: 1 })}
          >
            开工下一张
          </Button>
        </div>
      </div>

      {/* [XG-CUSTOM 2026-10-09] 「**正在跑**」—— 尤其是 `waiting_shell`：
          worker 可能正**排队等壳空闲**（最长 600s），没有这行用户会以为点完没反应 */}
      {running ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-info">
          <Dot state="ok" />
          <span>
            正在跑：{titleOf(running.taskId)}
            {running.phase === 'waiting_shell'
              ? ' —— **在等壳空闲**（别人正在用 GPU；最多等 600 秒）'
              : running.phase === 'generating'
                ? ' —— 正在出图'
                : ' —— 准备中'}
            · 已 {running.ageS} 秒
          </span>
        </div>
      ) : null}
      {w.running?.stale ? (
        <div className="text-xs text-foreground-warning">
          ⚠️ 有一份**陈旧的运行态残留**（pid {w.running.pid} 已不在）—— 多半是上次被强杀留下的；
          出图不受影响，点「刷新」若仍在可忽略
        </div>
      ) : null}

      {/* 最近一次出图的具体去处（**失败要能看见原因**） */}
      {w.last ? (
        <div className="text-xs text-foreground-passive">
          {w.last.title || w.last.task_id}
          {w.last.state === 'failed' && w.last.why ? ` —— 失败原因：${w.last.why}` : ''}
          {w.last.path ? ` → ${w.last.path.split('/').slice(-1)[0]}` : ''}
        </div>
      ) : null}

      {/* 待出图队列：**只列带「图片线」label 的 to-do 卡** —— 不是那 243 张卡堆
          （用户 2026-10-08 明确否掉过"平铺卡列表"：既没动作、又比 Kaneo 自己的看板难看）
          [XG-CUSTOM 2026-10-09] 失败卡**标红 + 显示原因 + 退避剩余**，按钮变「重试」：
          重试走 `--task-id` ⇒ **本就绕过退避**，所以"退避中"只是**提示**，不是拦阻。 */}
      {w.queue.length ? (
        <ul className="flex flex-col gap-1">
          {w.queue.map((c) => {
            const bad = c.state === 'failed';
            return (
              <li key={c.task_id} className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5">
                    <Dot state={bad ? 'down' : 'unknown'} />
                    <span className="truncate text-foreground-muted" title={c.task_id}>
                      {c.title}
                    </span>
                  </span>
                  {bad ? (
                    <span className="text-destructive pl-4 text-xs" title={c.why}>
                      {c.why || '（台账里没记原因）'}
                      {c.cooldownLeftS > 0
                        ? ` · 退避剩 ${Math.ceil(c.cooldownLeftS / 60)} 分`
                        : ' · 已过退避'}
                    </span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant={bad ? 'secondary' : 'ghost'}
                  disabled={busy}
                  title={
                    bad
                      ? '重试（点名会绕过退避；常驻开关关着也照跑）'
                      : w.enabled
                        ? '点名这一张立即出图'
                        : '常驻开关虽关，点名仍会跑一次（后台强制 KANEO_IMG_WORKER=1）'
                  }
                  onClick={() => void run({ action: 'run_image', taskId: c.task_id, limit: 1 })}
                >
                  {bad ? '重试' : '开工'}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-xs text-foreground-passive">
          队列空 —— 用上面「＋ 建卡」建一张，或去 Kaneo 把卡贴上「图片线」label 并置为待办
        </div>
      )}

      {showNew ? (
        <div className="border-border-subtle flex flex-col gap-2 rounded border px-2 py-2">
          <select
            className={FIELD_CLS}
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          >
            {projectOptions.map((o) => (
              <option key={o.projectId} value={o.projectId}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            className={FIELD_CLS}
            placeholder="标题（留空则取提示词前 40 字）"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className={cn(FIELD_CLS, 'h-20 resize-y')}
            placeholder="提示词（**必填** —— 没它出不了图）"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={cn(FIELD_CLS, 'w-40')}
              placeholder="负向提示词（可空）"
              value={form.negative}
              onChange={(e) => setForm({ ...form, negative: e.target.value })}
            />
            <select
              className={cn(FIELD_CLS, 'w-28')}
              value={form.aspectRatio}
              onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}
            >
              {['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !form.projectId || !form.prompt.trim()}
              onClick={() =>
                void run({
                  action: 'create_card',
                  projectId: form.projectId,
                  title: form.title,
                  prompt: form.prompt,
                  negative: form.negative,
                  aspectRatio: form.aspectRatio,
                })
              }
            >
              建卡
            </Button>
          </div>
          <div className="text-xs text-foreground-passive">
            建卡会**自动贴「图片线」label 并填好字段** ⇒ worker
            下一轮就会捡它出图（也可立刻点「开工」）
          </div>
        </div>
      ) : null}

      {outcome ? (
        <div
          className={cn(
            'rounded border border-border-subtle px-2 py-1 text-xs',
            outcome.tone === 'ok' ? 'text-foreground-success' : 'text-destructive'
          )}
        >
          {outcome.text}
        </div>
      ) : null}
    </div>
  );
}

export function KaneoBoardPanel() {
  const [data, setData] = useState<KaneoBoardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await kaneoBoard(false)) as KaneoBoardResult;
      if (!result?.ok) {
        setError(result?.error ?? '未知错误');
      } else {
        setData(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const diagrams = useMemo(() => data?.diagrams ?? [], [data]);

  // 默认选第一张（清单为空时保持空串）
  useEffect(() => {
    if (!picked && diagrams.length) setPicked(diagrams[0].name);
  }, [diagrams, picked]);

  const current = diagrams.find((d) => d.name === picked) ?? null;
  const totals = data?.totals;

  return (
    <div className="flex w-full flex-col gap-5">
      <PageLayout.Header
        title="Kaneo 看板"
        description="全流程状态 + Kaneo 概览 + Archify 系统图（一屏看住：出图引擎 / 图片线 / 排活 / 最近产物）"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1 h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {error ? (
        <div className="border-border-subtle text-muted-foreground rounded-md border px-3 py-2 text-sm">
          读取失败：{error}
          <div className="mt-1 text-xs">
            （数据源 <code>xiangwo-agent/kaneo_board.py board</code>；图由 8900 的{' '}
            <code>/xg/diagram/</code> 提供）
          </div>
        </div>
      ) : null}

      {/* [XG-CUSTOM 2026-10-09] 全流程一屏 —— **放在最上面**：用户要的是"一眼看住全流程" */}
      {data?.pipeline ? <PipelineStrip p={data.pipeline} /> : null}

      {/* [XG-CUSTOM 2026-10-09] 动作面：建卡 + 一键开工（"看得见"之上给"动得了"） */}
      {data?.pipeline ? (
        <ImageQueue
          p={data.pipeline}
          projectOptions={(data.projects ?? []).map((x) => ({
            projectId: x.projectId,
            name: x.name,
          }))}
          onChanged={() => void load()}
        />
      ) : null}

      {/* Kaneo 概览：一行数字（**不再平铺那 200 张卡**） */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {totals ? (
          <>
            <span className="flex items-center gap-1">
              <LayoutGrid className="h-4 w-4" />
              {totals.cards} 张卡
            </span>
            <span>·</span>
            <span>{totals.projects} 个项目</span>
            <span>·</span>
            <span>{totals.workspaces} 个工作区</span>
            <span>·</span>
            <span>更新于 {relTime(data?.generatedAt ?? '')}</span>
          </>
        ) : (
          <span>{loading ? '读取中…' : '无数据'}</span>
        )}
      </div>

      {data?.columns?.length ? (
        <div className="flex flex-wrap gap-2">
          {data.columns.map((c) => (
            <Badge key={c.slug} variant="soft">
              {COLUMN_LABEL[c.slug] ?? c.slug} {c.count}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* 图选择器（现在 2 张，用按钮组） */}
      {diagrams.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {diagrams.map((d) => (
            <Button
              key={d.name}
              size="sm"
              variant={d.name === picked ? 'primary' : 'secondary'}
              onClick={() => setPicked(d.name)}
            >
              <ImageIcon className="mr-1 h-4 w-4" />
              {d.title}
            </Button>
          ))}
          {current ? (
            <>
              <span className="text-muted-foreground text-xs">{humanSize(current.bytes)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // 图是自包含单文件 ⇒ 地址复制出去也能看（但只在同机可达）
                  void navigator.clipboard?.writeText(current.url).then(
                    () => toast.success('地址已复制'),
                    () => toast.error('复制失败')
                  );
                }}
              >
                复制地址
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 图本体 */}
      {current ? (
        <div className="border-border-subtle h-[68vh] min-h-[420px] w-full overflow-hidden rounded-md border bg-background">
          <iframe
            key={current.url}
            title={current.title}
            src={current.url}
            // allow-scripts（图需要 JS）；**不给 allow-same-origin** ⇒ 不透明源，读不到宿主存储
            sandbox="allow-scripts"
            className="h-full w-full border-0"
          />
        </div>
      ) : (
        <div className="border-border-subtle text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-6 text-sm">
          <ExternalLink className="h-4 w-4" />
          还没有图。生成方式见 <code>工具链/archify/图/README.md</code>
        </div>
      )}
    </div>
  );
}
