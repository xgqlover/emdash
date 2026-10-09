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
  KaneoBoardResult,
  KaneoPipeline,
} from '@core/primitives/desktop-host/api/host-contract';
import { kaneoBoard } from '@core/primitives/desktop-host/browser/host-client';
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
