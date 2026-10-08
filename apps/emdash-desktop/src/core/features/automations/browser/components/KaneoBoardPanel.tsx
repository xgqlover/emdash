// [XG-CUSTOM 2026-10-08] 「自动化」视图的 **Kaneo 看板面板**。
//
// 用户原话：「我想 Kaneo 的内容能在自动化下全面体现」。
// 定位：**卡 = 要做的活**，**automation = 什么时候自动做** ——
//       两者放同一个界面里，才是「排工作流」。
//
// 数据走 host 桥接 → `python3 xiangwo-agent/kaneo_board.py board`（与专家总览同款）。
// ⚠️ 那个脚本内部**必须分页**取卡（`list_tasks` 的 limit 上限 100，而 BABADO 已 110 张）。
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button, toast } from '@emdash/ui/react/primitives';
import { Copy, LayoutGrid, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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

function CardRow({ title, column, r1, subtasks }: {
  title: string;
  column: string;
  r1: string;
  subtasks: string;
}) {
  const [copied, setCopied] = useState(false);
  // 「排自动化」的最省做法：**把卡标题复制走** —— 新建自动化时粘进 Prompt 即可。
  // （不做跨组件预填：那个 Sheet 的状态在 AutomationsView 内部，硬塞参数会把简单事做复杂。）
  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(title)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error('复制失败'));
  }, [title]);

  return (
    <div className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={title}>
          {title}
        </div>
      </div>
      {r1 === 'r1-parent' && <Badge variant="soft">R1 蜂群</Badge>}
      {r1 === 'r1-expert' && <Badge variant="outline">R1 专家</Badge>}
      {subtasks !== '0/0' && <Badge variant="outline">{subtasks}</Badge>}
      <span className="shrink-0 text-xs text-muted-foreground">
        {COLUMN_LABEL[column] ?? column}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="opacity-0 transition-opacity group-hover:opacity-100"
        onClick={copy}
        aria-label="复制标题（用于新建自动化）"
        title="复制标题 → 新建自动化时粘进 Prompt"
      >
        <Copy className={cn('h-4 w-4', copied && 'text-emerald-500')} />
      </Button>
    </div>
  );
}

export function KaneoBoardPanel() {
  const [data, setData] = useState<KaneoBoardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const totals = data?.totals;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageLayout.Header
        title="Kaneo 看板"
        description="看板上的活 × 自动化 —— 复制卡标题，粘进新建自动化的 Prompt"
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
            （数据源 <code>xiangwo-agent/kaneo_board.py board</code>；需 Kaneo 在 5180 可读）
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
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

      <div className="flex w-full flex-col gap-4">
        {(data?.projects ?? []).map((p) => (
          <div key={p.projectId} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.workspace}</span>
              <Badge variant="outline">{p.count}</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {p.cards.slice(0, 20).map((c) => (
                <CardRow
                  key={c.id}
                  title={c.title}
                  column={c.column}
                  r1={c.r1}
                  subtasks={c.subtasks}
                />
              ))}
              {p.cards.length > 20 ? (
                <div className="px-3 text-xs text-muted-foreground">
                  … 还有 {p.cards.length - 20} 张（面板只显示前 20，避免一次渲染太多）
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
