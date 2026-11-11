// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「交接台」→ 卡片列表页：复用 automations 的 CollectionView + CollectionToolbar 卡片骨架
// 卡片：标题 + 状态徽章 + 摘要 + bot/专家/时间 pill + 删除；点卡片 → 详情 Sheet（概览 / 并入）
// 注：已去掉「接下」按钮（同专家记忆自带，跨专家交接未落地），并入对话是唯一动作
// 数据走 host 桥接 → python3 expert_handoff.py list/accept/delete/add（与 agent.py 后端共用 expert_topics.json）
// [XG-CUSTOM 2026-11-10] 入口说明 + 台账：见 emdash/CUSTOMIZATIONS.md §35；
//   grep `handoff-entry-help-2026-11-10` 可找回本块的 UI 与台账。
import { EmptyState } from '@emdash/ui/react/components';
import {
  CollectionToolbar,
  CollectionView,
  createListView,
  createTextMatcher,
  PageLayout,
} from '@emdash/ui/react/patterns';
import { AbsoluteTime, Alert, Button, Sheet, Tabs, ToggleGroup, toast } from '@emdash/ui/react/primitives';
import { Bot, CheckCircle2, Clock, FileText, MonitorSmartphone, Plus, Trash2, UserRound, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { listAllAcpChats } from '@core/features/conversations/browser/acp/acp-chat-resource-manager';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { ExpertHandoffTopic, TaskSpace } from '@core/primitives/desktop-host/api/host-contract';
import {
  expertHandoffAdd,
  expertHandoffDelete,
  expertHandoffDispatch,
  expertHandoffList,
  taskSpaceComplete,
  taskSpaceHandoff,
  taskSpaceList,
  taskSpaceTakeover,
} from '@core/primitives/desktop-host/browser/host-client';
import { cn } from '@core/primitives/styling/browser/cn';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
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

/** [XG-CUSTOM 2026-11-11] 后台 worker 票状态；和专家交接状态分开显示。 */
function TicketStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
    todo: { label: '后台待接', cls: 'bg-background-info text-foreground-info', icon: Clock },
    in_progress: { label: '后台执行中', cls: 'bg-background-info text-foreground-info', icon: Clock },
    in_review: { label: '后台待验收', cls: 'bg-background-warning text-foreground-warning', icon: Clock },
    done: { label: '后台已完成', cls: 'bg-background-success text-foreground-success', icon: CheckCircle2 },
    need_human: { label: '后台需人工', cls: 'bg-background-warning text-foreground-warning', icon: UserRound },
    failed: { label: '后台失败', cls: 'bg-destructive/10 text-destructive', icon: X },
    missing: { label: '票不存在', cls: 'bg-background-1 text-foreground-muted', icon: X },
  };
  const v = map[status] ?? { label: `后台 ${status}`, cls: 'bg-background-1 text-foreground-muted', icon: Clock };
  const Icon = v.icon;
  return (
    <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs', v.cls)}>
      <Icon className="size-3" />
      {v.label}
    </span>
  );
}

/** ACP 会话名：任务名优先，其次会话标题，最后才退回短 id（不再给用户看整串 uuid）。 */
function chatLabel(chat: ReturnType<typeof listAllAcpChats>[number]): string {
  const task = getTaskStore(chat.projectId, chat.taskId) as
    | { data?: { name?: string } }
    | undefined;
  const conv = conversationRegistry.get(chat.taskId)?.conversations.get(chat.conversationId)
    ?.data as { title?: string } | undefined;
  const taskName = String(task?.data?.name || '').trim();
  const title = String(conv?.title || '').trim();
  if (taskName && title && title !== taskName) return `${taskName} · ${title}`.slice(0, 72);
  return (taskName || title || `会话 ${chat.conversationId.slice(0, 8)}`).slice(0, 72);
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
  // [XG-CUSTOM 2026-11-10] 默认只看任务；「全部」保留历史噪声可查，不删数据。
  // 判据由 host 侧 expert_handoff.py::task_signal 统一提供，UI 不另写一套语义。
  filter: {
    kind: 'sync',
    initial: { scope: 'tasks' as 'tasks' | 'all' },
    apply: (topic, model: { scope: 'tasks' | 'all' }) =>
      model.scope === 'all' || topic.task_signal !== false,
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
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        ref={searchRef}
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

/** 范围切换：照 Emdash 原生任务列表的 TasksTabs（ToggleGroup + 计数），不另造筛选控件。 */
const HandoffTabs = observer(function HandoffTabs() {
  const filter = handoffListView.useFilter();
  const all = handoffListView.store.rawItems;
  const hidden = all.filter((topic) => topic.task_signal === false).length;
  const taskCount = all.length - hidden;
  return (
    <ToggleGroup.Root
      multiple={false}
      value={[filter.model.scope]}
      aria-label="交接范围"
      onValueChange={(values: unknown[]) => {
        const next = values[0] as 'tasks' | 'all' | undefined;
        if (next) filter.set({ scope: next });
      }}
    >
      <ToggleGroup.Item
        value="tasks"
        title={hidden > 0 ? `已隐藏 ${hidden} 条非任务；切换「全部」可查看` : undefined}
      >
        只看任务 ({taskCount})
      </ToggleGroup.Item>
      <ToggleGroup.Item value="all">全部 ({all.length})</ToggleGroup.Item>
    </ToggleGroup.Root>
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
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar.Root>
      <HandoffTabs />
      <CollectionToolbar.Separator />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Search
        ref={searchRef}
        value={search.query}
        onValueChange={search.setQuery}
        placeholder="搜索标题/摘要/专家/bot"
      />
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
  onOpen,
}: {
  topic: ExpertHandoffTopic;
  onDelete: (id: number) => void;
  onOpen: (topic: ExpertHandoffTopic) => void;
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
            {topic.ticket_id && <TicketStatusBadge status={topic.ticket_status} />}
            {topic.task_signal === false && (
              <span
                className="flex shrink-0 items-center rounded-md bg-background-1 px-1.5 py-0.5 text-xs text-foreground-muted"
                title={`非任务：${topic.task_reason || '未命中任务信号'}`}
              >
                非任务
              </span>
            )}
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
            <Button variant="ghost" size="sm" onClick={() => onOpen(topic)}>
              <FileText className="size-3" />
              详情
            </Button>
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

/** 空态：任务过滤隐藏了全部条目时，告诉用户「全部」里还有多少，而不是假装没有数据。 */
const HandoffEmpty = observer(function HandoffEmpty() {
  const filter = handoffListView.useFilter();
  const hidden = handoffListView.store.rawItems.filter((topic) => topic.task_signal === false).length;
  if (filter.model.scope === 'tasks' && hidden > 0) {
    return (
      <EmptyState
        bare
        label="没有任务条目"
        description={`${hidden} 条非任务已隐藏；切到「全部」可查看，不会删除数据`}
      />
    );
  }
  return <EmptyState bare label="暂无待接主题" description="点右上角「新建」手动写一个交接" />;
});

export function HandoffMainPanel() {
  const [tab, setTab] = useState<'expert' | 'spaces'>('expert');
  const [selected, setSelected] = useState<ExpertHandoffTopic | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'merge'>('overview');
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

  // 可用的 ACP 聊天（并入目标）；标签用任务名/会话名，不直接显示 uuid
  const chats = useMemo(() => listAllAcpChats(), [selected]);
  const chatOptions = useMemo(() => {
    const rows = chats.map((c) => ({ ...c, label: chatLabel(c) }));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
    return rows.map((r) =>
      (counts.get(r.label) ?? 0) > 1
        ? { ...r, label: `${r.label} · ${r.conversationId.slice(0, 4)}` }
        : r
    );
  }, [chats]);

  function openDetail(t: ExpertHandoffTopic) {
    setSelected(t);
    setDetailTab('overview');
    const body = t.ticket_result || t.summary || '';
    setMergeText(`[${t.id}] ${t.title}\n\n${body}`.trim());
    const first = chatOptions[0];
    const valid = chatOptions.some((c) => `${c.taskId}|${c.conversationId}` === target);
    if ((!target || !valid) && first) setTarget(`${first.taskId}|${first.conversationId}`);
  }

  // 派给后台 worker：只插票（todo），由该 bot 的常驻 worker 领；结果落 outbox，等用户决定是否并入。
  async function handleDispatch() {
    if (!selected) return;
    try {
      const updated = await expertHandoffDispatch(String(selected.id));
      if (updated && typeof updated === 'object') {
        setSelected(updated as ExpertHandoffTopic);
        toast('已派给后台', {
          description: `${updated.ticket_worker || updated.bot || 'worker'} · ticket ${updated.ticket_id || ''}`,
        });
      }
      reload();
    } catch (e) {
      toast.error('派单失败', { description: (e as Error).message });
    }
  }

  async function refreshSelected() {
    if (!selected) return;
    try {
      const list = await expertHandoffList('', '');
      const found = Array.isArray(list)
        ? (list as ExpertHandoffTopic[]).find((t) => t.id === selected.id)
        : undefined;
      if (found) {
        setSelected(found);
        if (found.ticket_result) {
          setMergeText(`[${found.id}] ${found.title}\n\n${found.ticket_result}`.trim());
        }
        toast('已刷新后台状态', { description: found.ticket_status || '无票状态' });
      }
    } catch (e) {
      toast.error('刷新失败', { description: (e as Error).message });
    }
  }

  // 有票且未完成时，每 5 秒刷新一次详情（不轮询列表整体，避免 355KB 反复拉）
  useEffect(() => {
    if (!selected?.ticket_id) return;
    if (['done', 'failed', 'need_human', 'missing'].includes(selected.ticket_status || '')) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const list = await expertHandoffList('', '');
        const found = Array.isArray(list)
          ? (list as ExpertHandoffTopic[]).find((t) => t.id === selected.id)
          : undefined;
        if (!stopped && found) setSelected(found);
      } catch {
        /* 下一轮再试 */
      }
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selected?.id, selected?.ticket_id, selected?.ticket_status]);

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
          description="专家任务交接 + 浏览器页面控制权交接；这里只交接，不自动执行"
        />
        {/* 双 Tab 切换：不放进滚动区，保证切页时头部不跑 */}
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'expert' | 'spaces')}>
          <Tabs.List>
            <Tabs.Tab
              value="expert"
              title="接别的会话里的专家结论/产物；并入只填聊天草稿，不自动发送，也不启动 worker"
            >
              专家交接
            </Tabs.Tab>
            <Tabs.Tab
              value="spaces"
              title="接管 agent 正在操作的浏览器页面；接手后 agent 停手，完成后归还"
            >
              浏览器工作台
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>

        {/* [XG-CUSTOM 2026-11-10] 交接台入口说明（用户要求把「功用」写在入口，避免只看到列表不知道怎么用）。
            台账：emdash/CUSTOMIZATIONS.md §35；grep `handoff-entry-help-2026-11-10`。
            不放进滚动区：切 Tab / 滚动列表时说明始终可见。 */}
        <Alert.Root
          status="info"
          data-xg-custom="handoff-entry-help-2026-11-10"
          className="shrink-0"
        >
          <Alert.Title>交接台做什么</Alert.Title>
          <Alert.Description>
            <span className="block">
              「专家交接」接的是别的会话里专家的结论/产物；点「并入」只把摘要填进当前聊天草稿，不自动发送，也不启动后台 worker。
            </span>
            <span className="block">
              「浏览器工作台」接的是页面控制权；你接手后 agent 停手，点「完成」再还给它。这里不是聊天窗口，也不按时间自动执行。
            </span>
            <span className="block">
              列表默认「只看任务」；历史闲聊、助手自我介绍、工具目录等收进「全部」，
              只改显示、不删数据。
            </span>
          </Alert.Description>
        </Alert.Root>

        <div className="relative min-h-0 w-full min-w-0 flex-1 overflow-y-auto">
          {tab === 'expert' ? (
            <handoffListView.Root>
              <CollectionView
                view={handoffListView}
                layout="grouped"
                estimateSize={104}
                renderRow={(topic) => (
                  <HandoffRow topic={topic} onDelete={handleDelete} onOpen={openDetail} />
                )}
                toolbar={<HandoffToolbar onNew={() => setShowNew(true)} onRefresh={reload} />}
                onItemClick={(topic) => openDetail(topic)}
                emptySlot={<HandoffEmpty />}
                errorSlot={
                  <EmptyState
                    bare
                    label="读取交接台失败"
                    description="检查 expert_handoff.py 桥接"
                  />
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
                  <EmptyState
                    bare
                    label="暂无浏览器工作台页面"
                    description="agent 侧边干活时会自动开一个 space，干完把控制权交给你"
                  />
                }
                errorSlot={
                  <EmptyState
                    bare
                    label="读取浏览器工作台失败"
                    description="检查 wego-lite/task-spaces/task-spaces.mjs 桥接与 node 路径"
                  />
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

      {/* 交接详情 Sheet：照 AutomationDetailView 的「标题 + Tabs + 底部动作」骨架 */}
      <Sheet.Root open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          {selected && (
            <div className="flex h-full flex-col">
              <div className="flex flex-row items-center justify-between gap-1.5 p-4">
                <span className="text-sm font-medium text-foreground">交接详情</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="p-0">
                  <X className="size-4" />
                </Button>
              </div>

              <div className="px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-lg text-foreground">
                    [{selected.id}] {selected.title}
                  </span>
                  <TopicStatusBadge status={selected.status} />
                  {selected.ticket_id && <TicketStatusBadge status={selected.ticket_status} />}
                </div>
                <p className="mt-1 text-xs text-foreground-muted">
                  专家交接 · 上下文与产出，不是浏览器页面控制权
                </p>
              </div>

              <div className="px-4 pt-3">
                <Tabs.Root
                  value={detailTab}
                  onValueChange={(value) => setDetailTab(value as 'overview' | 'merge')}
                >
                  <Tabs.List>
                    <Tabs.Tab value="overview">概览</Tabs.Tab>
                    <Tabs.Tab value="merge">并入</Tabs.Tab>
                  </Tabs.List>
                </Tabs.Root>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {detailTab === 'overview' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
                      <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1">
                        <Bot className="size-3" />
                        {selected.bot || '未知业务线'}
                      </span>
                      <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1">
                        <UserRound className="size-3" />
                        {expertLabel(selected.expert)}
                      </span>
                      <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1">
                        <Clock className="size-3" />
                        <AbsoluteTime value={selected.created * 1000} />
                      </span>
                    </div>

                    <section className="rounded-lg border border-border p-3">
                      <h3 className="text-xs font-medium text-foreground-muted">摘要</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                        {selected.summary || '（无摘要）'}
                      </p>
                    </section>

                    <section className="rounded-lg border border-border p-3">
                      <h3 className="flex items-center gap-1 text-xs font-medium text-foreground-muted">
                        <FileText className="size-3" />
                        关联产出
                      </h3>
                      <p className="mt-2 break-all font-mono text-xs text-foreground-muted">
                        {selected.file || '（无关联文件）'}
                      </p>
                    </section>

                    {selected.ticket_id ? (
                      <section className="rounded-lg border border-border p-3">
                        <h3 className="flex items-center gap-1 text-xs font-medium text-foreground-muted">
                          <Bot className="size-3" />
                          后台 worker
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                          <TicketStatusBadge status={selected.ticket_status} />
                          <span className="font-mono">{selected.ticket_id}</span>
                          {selected.ticket_worker && <span>· {selected.ticket_worker}</span>}
                        </div>
                        {selected.ticket_result ? (
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-background-1 p-2 text-xs text-foreground">
                            {selected.ticket_result}
                          </pre>
                        ) : (
                          <p className="mt-3 text-xs text-foreground-muted">
                            {selected.ticket_status === 'done'
                              ? '后台已完成，但还没读到结果；点「刷新后台」再试。'
                              : '已入队，worker 完成后结果会出现在这里；也可以先「并入对话」把当前摘要填进草稿。'}
                          </p>
                        )}
                      </section>
                    ) : null}

                    <p className="text-xs text-foreground-muted">
                      「并入」只把上下文填进目标聊天输入框，不自动发送；「派给后台」才会让该 bot 的 worker 去做。
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-xs text-foreground-muted">并入内容</label>
                      <textarea
                        value={mergeText}
                        onChange={(e) => setMergeText(e.target.value)}
                        className="mt-1 min-h-40 w-full rounded-md border border-border bg-background-1 p-3 text-sm text-foreground"
                        placeholder="并入对话的摘要内容"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-foreground-muted">并入到谁的聊天</label>
                      <select
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        className="mt-1 w-full rounded-md border border-border bg-background-1 p-2 text-sm text-foreground"
                      >
                        {chatOptions.length === 0 ? (
                          <option value="">（没有打开的聊天）</option>
                        ) : (
                          chatOptions.map((c) => (
                            <option
                              key={`${c.taskId}|${c.conversationId}`}
                              value={`${c.taskId}|${c.conversationId}`}
                            >
                              {c.label}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <Sheet.Footer className="flex flex-row items-center justify-end gap-2">
                {detailTab === 'overview' ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                      关闭
                    </Button>
                    {selected.ticket_id ? (
                      <Button variant="secondary" size="sm" onClick={() => void refreshSelected()}>
                        刷新后台
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => void handleDispatch()}>
                        派给后台
                      </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={() => setDetailTab('merge')}>
                      并入对话
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setDetailTab('overview')}>
                      返回
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleMerge}
                      disabled={!mergeText.trim() || !target}
                    >
                      并入对话
                    </Button>
                  </>
                )}
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
