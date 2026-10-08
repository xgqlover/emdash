// [XG-CUSTOM 2026-10-08] 「自动化」视图的 **Kaneo 看板** 面板 —— 现在是**系统图浏览**。
//
// 用户原话：「我不是加了个能画工作流图能力，**能在 emdash 可以看**吗」
//
// ## 为什么从"卡列表"改成"图浏览"
// 第一版我列的是**平的 200 张卡**，用户当场指出「还是两个不同的东西拼一起」——
// 那是实话：那个列表既没有动作、又比 Kaneo 自己的看板难看，纯属重复。
// 现在改成：**Kaneo 概览（一行数字 + 列徽章）+ Archify 图（可交互，直接在这里看）**。
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KaneoBoardResult } from '@core/primitives/desktop-host/api/host-contract';
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
        description="Kaneo 概览 + Archify 系统图（图直接在这里看，不用开 Kaneo 窗口）"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1 h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-border-subtle px-3 py-2 text-sm text-muted-foreground">
          读取失败：{error}
          <div className="mt-1 text-xs">
            （数据源 <code>xiangwo-agent/kaneo_board.py board</code>；图由 8900 的{' '}
            <code>/xg/diagram/</code> 提供）
          </div>
        </div>
      ) : null}

      {/* Kaneo 概览：一行数字（**不再平铺那 200 张卡**） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
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
              <span className="text-xs text-muted-foreground">{humanSize(current.bytes)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // 图是自包含单文件 ⇒ 地址复制出去也能看（但只在同机可达）
                  void navigator.clipboard?.writeText(current.url).then(
                    () => toast.success('地址已复制'),
                    () => toast.error('复制失败'),
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
        <div className="h-[68vh] min-h-[420px] w-full overflow-hidden rounded-md border border-border-subtle bg-background">
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
        <div className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-6 text-sm text-muted-foreground">
          <ExternalLink className="h-4 w-4" />
          还没有图。生成方式见 <code>工具链/archify/图/README.md</code>
        </div>
      )}
    </div>
  );
}
