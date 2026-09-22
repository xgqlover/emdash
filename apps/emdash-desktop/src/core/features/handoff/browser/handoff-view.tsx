// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「交接台」→ 列表页：按专家分组 + 状态徽章（复用 automations RunStatusBadge + builtin-catalog 模式）
// 点主题 → Sheet 抽屉（复用 automations Sheet 骨架）：可编辑摘要 + 产生时间 + 目标会话 + 右下角「并入对话」
// 数据走 host 桥接 → python3 expert_handoff.py list/accept/delete（与 agent.py 后端共用 expert_topics.json）
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Clock, Trash2, UserRound, X } from 'lucide-react';
import { AbsoluteTime, Button, Sheet, toast } from '@emdash/ui/react/primitives';
import { defineViewRuntime } from '@core/primitives/views/react';
import { handoffViewDef } from '../contributions/views';
import { cn } from '@core/primitives/styling/browser/cn';
import { listAllAcpChats } from '@core/features/conversations/browser/acp/acp-chat-resource-manager';
import {
  expertHandoffAccept,
  expertHandoffDelete,
  expertHandoffList,
} from '@core/primitives/desktop-host/browser/host-client';
import type { ExpertHandoffTopic } from '@core/primitives/desktop-host/api/host-contract';

// 状态徽章（对齐 automations RunStatusBadge：图标 + 颜色）
function TopicStatusBadge({ status }: { status: string }) {
  if (status === 'accepted') {
    return (
      <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs bg-background-success text-foreground-success')}>
        <CheckCircle2 className="size-3" />
        已接
      </span>
    );
  }
  return (
    <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs bg-background-info text-foreground-info')}>
      <Clock className="size-3" />
      待接
    </span>
  );
}

// 剥离品牌名前缀，显示角色名（「BABADO用户研究员」→「用户研究员」），对齐 agent.py _list_r2_experts 前缀剥离
function expertLabel(expert: string): string {
  for (const bp of ['尚享设计', 'BABADO', '大翼', '上茶', '硕博', '云悠']) {
    if (expert.startsWith(bp)) return expert.slice(bp.length);
  }
  return expert;
}

export function HandoffMainPanel() {
  const [topics, setTopics] = useState<ExpertHandoffTopic[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ExpertHandoffTopic | null>(null);
  const [mergeText, setMergeText] = useState('');
  const [target, setTarget] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await expertHandoffList('', '');
      setTopics(Array.isArray(list) ? list : []);
    } catch {
      setTopics([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAccept = useCallback(
    async (id: number) => {
      try {
        await expertHandoffAccept(String(id));
      } catch {
        /* 忽略 */
      }
      void refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await expertHandoffDelete(String(id));
      } catch {
        /* 忽略 */
      }
      void refresh();
    },
    [refresh]
  );

  // 按 bot → 专家 二级分组（对齐 automations builtin-catalog 的 category 分组模式）
  const grouped = useMemo(() => {
    const byBot = new Map<string, Map<string, ExpertHandoffTopic[]>>();
    for (const t of topics) {
      const bot = t.bot || '未知业务线';
      const expert = t.expert || '未知专家';
      if (!byBot.has(bot)) byBot.set(bot, new Map());
      const byExpert = byBot.get(bot)!;
      if (!byExpert.has(expert)) byExpert.set(expert, []);
      byExpert.get(expert)!.push(t);
    }
    return byBot;
  }, [topics]);

  const pendingCount = topics.filter((t) => t.status !== 'accepted').length;

  // 可用的 ACP 聊天（并入目标）
  const chats = useMemo(() => listAllAcpChats(), [selected]);

  function openMerge(t: ExpertHandoffTopic) {
    setSelected(t);
    setMergeText(`[${t.id}] ${t.title}\n\n${t.summary || ''}`.trim());
    if (!target) {
      const first = listAllAcpChats()[0];
      if (first) setTarget(`${first.taskId}|${first.conversationId}`);
    }
  }

  function handleMerge() {
    if (!selected || !target) return;
    const idx = target.indexOf('|');
    const taskId = target.slice(0, idx);
    const conversationId = target.slice(idx + 1);
    const store = listAllAcpChats().find(
      (c) => c.taskId === taskId && c.conversationId === conversationId
    )?.store;
    if (!store) {
      toast.error('并入失败', { description: '没找到目标会话' });
      return;
    }
    store.setDraftText(mergeText);
    setSelected(null);
    toast('已并入对话', { description: '摘要已填入目标聊天输入框，点发送即可' });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-foreground">交接台</h1>
          {!busy && topics.length > 0 && (
            <span className="text-xs text-foreground-muted">
              {topics.length} 个主题 · {pendingCount} 待接
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted hover:bg-background-secondary"
        >
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {busy ? (
          <p className="text-sm text-foreground-muted">加载中…</p>
        ) : topics.length === 0 ? (
          <p className="text-sm text-foreground-muted">暂无待接主题</p>
        ) : (
          <div className="space-y-5">
            {Array.from(grouped.entries()).map(([bot, byExpert]) => (
              <section key={bot} className="space-y-4">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Bot className="size-4" />
                  {bot}
                </div>
                {Array.from(byExpert.entries()).map(([expert, list]) => (
                  <div key={expert}>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                      <UserRound className="size-3.5" />
                      {expertLabel(expert)}
                      <span className="text-foreground-muted/60">· {list.length}</span>
                    </div>
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li
                      key={t.id}
                      onClick={() => openMerge(t)}
                      className="cursor-pointer rounded-md border border-border p-3 transition-colors hover:bg-background-secondary"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 truncate text-sm font-medium text-foreground">
                              [{t.id}] {t.title}
                            </span>
                            <TopicStatusBadge status={t.status} />
                          </div>
                          {t.summary ? (
                            <div className="mt-1 text-xs text-foreground-muted">{t.summary}</div>
                          ) : null}
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-foreground-muted/60">
                            <AbsoluteTime value={t.created * 1000} />
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleAccept(t.id);
                            }}
                            disabled={t.status === 'accepted'}
                            className="rounded-md bg-(--em-accent) px-2.5 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40"
                          >
                            接下
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(t.id);
                            }}
                            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-foreground-muted hover:bg-background-secondary"
                          >
                            <Trash2 className="size-3" />
                            删除
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 并入对话 Sheet（复用 automations Sheet 骨架） */}
      <Sheet.Root open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          {selected && (
            <div className="flex h-full flex-col">
              <div className="flex flex-row items-center justify-between gap-1.5 p-4">
                <span className="text-sm font-medium text-foreground">并入对话</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="p-0">
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto px-4">
                <div className="flex items-center gap-2 text-xs text-foreground-muted">
                  <UserRound className="size-3.5" />
                  {expertLabel(selected.expert)}
                  <TopicStatusBadge status={selected.status} />
                  <span className="text-foreground-muted/60">
                    <AbsoluteTime value={selected.created * 1000} />
                  </span>
                </div>
                <textarea
                  value={mergeText}
                  onChange={(e) => setMergeText(e.target.value)}
                  className="mt-3 min-h-40 w-full rounded-md border border-border bg-background-1 p-3 text-sm text-foreground"
                  placeholder="并入对话的摘要内容"
                />
                <div className="mt-3">
                  <label className="text-xs text-foreground-muted">并入到谁的聊天</label>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  >
                    {chats.length === 0 ? (
                      <option value="">（没有打开的聊天）</option>
                    ) : (
                      chats.map((c) => (
                        <option key={`${c.taskId}|${c.conversationId}`} value={`${c.taskId}|${c.conversationId}`}>
                          {c.conversationId}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <Sheet.Footer className="flex flex-row items-center justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleMerge}
                  disabled={!mergeText.trim() || !target}
                >
                  并入对话
                </Button>
              </Sheet.Footer>
            </div>
          )}
        </Sheet.Content>
      </Sheet.Root>
    </div>
  );
}

export const handoffViewRuntime = defineViewRuntime(handoffViewDef, {
  slots: { main: HandoffMainPanel },
});
