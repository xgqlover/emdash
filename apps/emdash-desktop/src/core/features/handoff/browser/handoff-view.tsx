// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「交接台」→ 卡片列表页：复用 automations 的 CollectionView + CollectionToolbar 卡片骨架
// 卡片：标题 + 状态徽章 + 摘要 + bot/专家/时间 pill + 删除；点卡片 → Sheet（可编辑摘要 + 并入对话）
// 注：已去掉「接下」按钮（同专家记忆自带，跨专家交接未落地），并入对话是唯一动作
// 数据走 host 桥接 → python3 expert_handoff.py list/accept/delete/add（与 agent.py 后端共用 expert_topics.json）
import {
  CollectionToolbar,
  CollectionView,
  createListView,
  createTextMatcher,
  PageLayout,
} from '@emdash/ui/react/patterns';
import { AbsoluteTime, Button, Sheet, Tabs, toast } from '@emdash/ui/react/primitives';
import { Bot, CheckCircle2, Clock, MonitorSmartphone, Plus, Trash2, UserRound, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { listAllAcpChats } from '@core/features/conversations/browser/acp/acp-chat-resource-manager';
import type { ExpertHandoffTopic, TaskSpace } from '@core/primitives/desktop-host/api/host-contract';
import {
  expertHandoffAdd,
  expertHandoffDelete,
  expertHandoffList,
  taskSpaceComplete,
  taskSpaceHandoff,
  taskSpaceList,
  taskSpaceTakeover,
} from '@core/primitives/desktop-host/browser/host-client';
import { cn } from '@core/primitives/styling/browser/cn';
import { defineViewRuntime } from '@core/primitives/views/react';
import { handoffViewDef } from '../contributions/views';

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

// 列表骨架（复用 UI kit 的 CollectionView 卡片模式，和 automations 页一致）
const handoffListView = createListView({
  getItemId: (topic: ExpertHandoffTopic) => String(topic.id),
  source: {
    kind: 'async',
    load: async () => {
      const list = await expertHandoffList('', '');
      return Array.isArray(list) ? (list as ExpertHandoffTopic[]) : [];
    },
  },
  search: {
    kind: 'sync',
    predicate: createTextMatcher((topic: ExpertHandoffTopic) => [
      topic.title,
      topic.summary,
      topic.expert,
      topic.bot,
    ]),
  },
  sections: {
    by: (topic: ExpertHandoffTopic) => `${topic.bot || '未知业务线'} · ${expertLabel(topic.expert)}`,
  },
});

// ───────────────────────── 第二个 Tab：浏览器工作台（task-spaces）─────────────────────────
// 交的东西是**浏览器页面控制权**（ownership 三态），和上面「专家交接台」交的**任务**是两件事。
// 数据：wego-lite/task-spaces/spaces.json ← task-spaces.mjs（经 host 桥接，本机 spawn / 远程 SSH）
// ownership：agent=agent 拥有 / agentDelegatedToUser=控制权临时交给用户 / user=用户拥有

const OWNERSHIP_LABEL: Record<string, string> = {
  agent: 'agent 在操作',
  agentDelegatedToUser: '交给用户待接',
  user: '用户拥有',
};

function OwnershipBadge({ ownership }: { ownership: string }) {
  if (ownership === 'agentDelegatedToUser') {
    return (
      <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs bg-background-success text-foreground-success')}>
        <MonitorSmartphone className="size-3" />
        待接
      </span>
    );
  }
  if (ownership === 'user') {
    return (
      <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs bg-background-1 text-foreground-muted')}>
        <UserRound className="size-3" />
        用户拥有
      </span>
    );
  }
  return (
    <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs bg-background-info text-foreground-info')}>
      <Bot className="size-3" />
      agent 在操作
    </span>
  );
}

const spaceListView = createListView({
  getItemId: (space: TaskSpace) => String(space.id),
  source: {
    kind: 'async',
    load: async () => {
      const list = await taskSpaceList();
      return Array.isArray(list) ? (list as TaskSpace[]) : [];
    },
  },
  search: {
    kind: 'sync',
    predicate: createTextMatcher((space: TaskSpace) => [space.name, space.ownership]),
  },
  sections: {
    by: (space: TaskSpace) => OWNERSHIP_LABEL[space.ownership] ?? space.ownership,
  },
});

const SpaceCounts = observer(function SpaceCounts() {
  const list = spaceListView.useListView();
  if (list.status === 'loading' && list.visibleItems.length === 0) {
    return <span className="shrink-0 text-xs text-foreground-muted">加载中…</span>;
  }
  const waiting = list.visibleItems.filter((s) => s.ownership === 'agentDelegatedToUser').length;
  return (
    <span className="shrink-0 text-xs text-foreground-muted">
      {list.visibleItems.length} 个页面 · {waiting} 待接
    </span>
  );
});

const SpaceToolbar = observer(function SpaceToolbar({ onRefresh }: { onRefresh: () => void }) {
  const search = spaceListView.useSearch();
  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        value={search.query}
        onValueChange={search.setQuery}
        placeholder="搜索页面名"
      />
      <SpaceCounts />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          刷新
        </Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
  );
});

function SpaceRow({
  space,
  onAct,
}: {
  space: TaskSpace;
  onAct: (cmd: 'handoff' | 'takeover' | 'complete', id: number) => void;
}) {
  const isAgentOwned = space.ownership === 'agent';
  const isWaiting = space.ownership === 'agentDelegatedToUser';
  const isUserOwned = space.ownership === 'user';
  return (
    <div className="group flex w-full items-start gap-4 text-left">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 第 1 行：名字 + 归属徽章 左，id pill 右 */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-md text-foreground">{space.name || `space #${space.id}`}</span>
            <OwnershipBadge ownership={space.ownership} />
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-foreground-muted">
            <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1 group-hover:bg-background-2">
              #{space.id}
            </span>
            <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1 group-hover:bg-background-2">
              {space.tabs?.length ?? 0} 个标签页
            </span>
          </div>
        </div>

        {/* 第 2 行：动作按钮（按 ownership 互斥，不能冒泡到整行点击） */}
        <div
          className="flex shrink-0 gap-1"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isWaiting && (
            <Button variant="primary" size="sm" onClick={() => onAct('takeover', space.id)}>
              接手
            </Button>
          )}
          {isAgentOwned && (
            <Button variant="secondary" size="sm" onClick={() => onAct('handoff', space.id)}>
              交给用户
            </Button>
          )}
          {isUserOwned && (
            <Button variant="secondary" size="sm" onClick={() => onAct('takeover', space.id)}>
              认领
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onAct('complete', space.id)}>
            <CheckCircle2 className="size-3" />
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 工具条左侧的计数（搜索后按可见项算，和旧版「N 个主题 · M 待接」一致）。 */
const HandoffCounts = observer(function HandoffCounts() {
  const list = handoffListView.useListView();
  if (list.status === 'loading' && list.visibleItems.length === 0) {
    return <span className="shrink-0 text-xs text-foreground-muted">加载中…</span>;
  }
  const pending = list.visibleItems.filter((topic) => topic.status !== 'accepted').length;
  return (
    <span className="shrink-0 text-xs text-foreground-muted">
      {list.visibleItems.length} 个主题 · {pending} 待接
    </span>
  );
});

const HandoffToolbar = observer(function HandoffToolbar({
  onNew,
  onRefresh,
}: {
  onNew: () => void;
  onRefresh: () => void;
}) {
  const search = handoffListView.useSearch();
  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        value={search.query}
        onValueChange={search.setQuery}
        placeholder="搜索标题/摘要/专家/bot"
      />
      <HandoffCounts />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          刷新
        </Button>
        <Button variant="primary" size="sm" onClick={onNew}>
          <Plus className="size-3.5" />
          新建
        </Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
  );
});

/** 卡片行（对齐 AutomationRow 的两行结构：主行 + meta pill，次行 + 操作）。 */
function HandoffRow({
  topic,
  onDelete,
}: {
  topic: ExpertHandoffTopic;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="group flex w-full items-start gap-4 text-left">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 第 1 行：标题 + 状态徽章 左，bot/专家/时间 pill 右 */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-md text-foreground">
              [{topic.id}] {topic.title}
            </span>
            <TopicStatusBadge status={topic.status} />
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-foreground-muted">
            <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1 group-hover:bg-background-2">
              <Bot className="size-3 shrink-0" />
              <span className="shrink-0">{topic.bot || '未知业务线'}</span>
            </span>
            <span className="flex max-w-40 items-center gap-1.5 rounded-md bg-background-1 px-2 py-1 group-hover:bg-background-2">
              <UserRound className="size-3 shrink-0" />
              <span className="min-w-0 truncate text-xs font-normal">
                {expertLabel(topic.expert)}
              </span>
            </span>
            <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1 group-hover:bg-background-2">
              <Clock className="size-3 shrink-0" />
              <AbsoluteTime value={topic.created * 1000} />
            </span>
          </div>
        </div>

        {/* 第 2 行：摘要 左，操作 右（按钮不能冒泡到整行点击） */}
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="line-clamp-2 min-w-0 flex-1 text-sm text-foreground-muted">
            {topic.summary || '（无摘要）'}
          </span>
          <div
            className="flex shrink-0 gap-1"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Button variant="ghost" size="sm" onClick={() => onDelete(topic.id)}>
              <Trash2 className="size-3" />
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HandoffMainPanel() {
  const [tab, setTab] = useState<'expert' | 'spaces'>('expert');
  const [selected, setSelected] = useState<ExpertHandoffTopic | null>(null);
  const [mergeText, setMergeText] = useState('');
  const [target, setTarget] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ bot: '', expert: '', title: '', summary: '', context: '' });

  const reload = useCallback(() => void handoffListView.reload(), []);

  const handleAdd = useCallback(async () => {
    try {
      await expertHandoffAdd(newForm.bot, newForm.expert, newForm.title, newForm.summary, '', newForm.context);
      setShowNew(false);
      setNewForm({ bot: '', expert: '', title: '', summary: '', context: '' });
      reload();
    } catch {
      /* 忽略 */
    }
  }, [newForm, reload]);

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await expertHandoffDelete(String(id));
      } catch {
        /* 忽略 */
      }
      reload();
    },
    [reload]
  );

  // ── 浏览器工作台（第二个 Tab）──
  const reloadSpaces = useCallback(() => void spaceListView.reload(), []);

  const handleSpaceAct = useCallback(
    async (cmd: 'handoff' | 'takeover' | 'complete', id: number) => {
      try {
        if (cmd === 'handoff') {
          await taskSpaceHandoff(String(id));
          toast('已交给用户', { description: '控制权在你这，可在交接台接手' });
        } else if (cmd === 'takeover') {
          await taskSpaceTakeover(String(id));
          toast('已接手', { description: '控制权回到 agent' });
        } else {
          await taskSpaceComplete(String(id), false);
          toast('已完成', { description: 'space 已关闭' });
        }
      } catch (e) {
        toast.error('操作失败', { description: (e as Error).message });
      }
      reloadSpaces();
    },
    [reloadSpaces]
  );

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
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-8 py-8">
        <PageLayout.Header
          title="交接台"
          description="两件事分开：「专家交接」交的是任务，「浏览器工作台」交的是页面控制权"
        />
        {/* 双 Tab 切换：不放进滚动区，保证切页时头部不跑 */}
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'expert' | 'spaces')}>
          <Tabs.List>
            <Tabs.Tab value="expert">专家交接</Tabs.Tab>
            <Tabs.Tab value="spaces">浏览器工作台</Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>

        <div className="relative min-h-0 w-full min-w-0 flex-1 overflow-y-auto">
          {tab === 'expert' ? (
            <handoffListView.Root>
              <CollectionView
                view={handoffListView}
                layout="grouped"
                estimateSize={104}
                renderRow={(topic) => <HandoffRow topic={topic} onDelete={handleDelete} />}
                toolbar={<HandoffToolbar onNew={() => setShowNew(true)} onRefresh={reload} />}
                onItemClick={(topic) => openMerge(topic)}
                emptySlot={
                  <p className="p-6 text-sm text-foreground-muted">
                    暂无待接主题，点右上角「新建」手动写一个交接
                  </p>
                }
                errorSlot={
                  <p className="p-6 text-sm text-foreground-muted">
                    读取交接台失败（检查 expert_handoff.py 桥接）
                  </p>
                }
              />
            </handoffListView.Root>
          ) : (
            <spaceListView.Root>
              <CollectionView
                view={spaceListView}
                layout="grouped"
                estimateSize={104}
                renderRow={(space) => <SpaceRow space={space} onAct={handleSpaceAct} />}
                toolbar={<SpaceToolbar onRefresh={reloadSpaces} />}
                emptySlot={
                  <p className="p-6 text-sm text-foreground-muted">
                    暂无浏览器工作台页面。agent 侧边干活时（/use）会自动开一个 space，
                    干完把控制权交给你，这里就会亮起来。
                  </p>
                }
                errorSlot={
                  <p className="p-6 text-sm text-foreground-muted">
                    读取浏览器工作台失败（检查 wego-lite/task-spaces/task-spaces.mjs 桥接与 node 路径）
                  </p>
                }
              />
            </spaceListView.Root>
          )}
        </div>
      </div>

      {/* [XG-CUSTOM] 新建交接 Sheet */}
      <Sheet.Root open={showNew} onOpenChange={(open) => !open && setShowNew(false)}>
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          <div className="flex h-full flex-col">
            <div className="flex flex-row items-center justify-between gap-1.5 p-4">
              <span className="text-sm font-medium text-foreground">新建交接</span>
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)} className="p-0">
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-foreground-muted">业务线（bot）</label>
                  <input
                    value={newForm.bot}
                    onChange={(e) => setNewForm({ ...newForm, bot: e.target.value })}
                    placeholder="如 sxsj"
                    className="mt-1 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground-muted">接手专家</label>
                  <input
                    value={newForm.expert}
                    onChange={(e) => setNewForm({ ...newForm, expert: e.target.value })}
                    placeholder="如 design-brand-guardian（接下去做的专家）"
                    className="mt-1 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground-muted">标题</label>
                  <input
                    value={newForm.title}
                    onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                    placeholder="交接任务标题"
                    className="mt-1 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground-muted">摘要</label>
                  <textarea
                    value={newForm.summary}
                    onChange={(e) => setNewForm({ ...newForm, summary: e.target.value })}
                    placeholder="交接内容摘要"
                    className="mt-1 min-h-20 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground-muted">完整上下文（可选）</label>
                  <textarea
                    value={newForm.context}
                    onChange={(e) => setNewForm({ ...newForm, context: e.target.value })}
                    placeholder="交接给专家的完整上下文/前专家产出"
                    className="mt-1 min-h-20 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                  />
                </div>
              </div>
            </div>
            <Sheet.Footer className="flex flex-row items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowNew(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleAdd()}
                disabled={!newForm.title.trim() || !newForm.expert.trim()}
              >
                创建交接
              </Button>
            </Sheet.Footer>
          </div>
        </Sheet.Content>
      </Sheet.Root>

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
  slots: { wrap: Fragment, main: HandoffMainPanel },
});
