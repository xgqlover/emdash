import { toast } from '@emdash/ui/react/primitives';
import { useLayoutEffect, type ReactNode } from 'react';
import { browserControlsRegistry } from '@core/features/browser/api/browser/browser-controls-registry';
import type { BrowserTabResource } from '@core/features/browser/api/browser/browser-tab-resource';
// [XG-CUSTOM] 2026-10-06 —— 复用开页：`task.openBrowser`（人主动"新开浏览器"）显式关掉复用
import { openBrowserTabOrReuse } from '@core/features/browser/api/browser/open-browser-tab';
// [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（browser.openUrl）的纯逻辑：校验 / 决策 / 开页
import {
  openUrlInBrowserPane,
  planOpenUrlCommand,
} from '@core/features/browser/browser/open-url-command';
import {
  runGitFetch,
  runGitPublishCurrentBranch,
  runGitPull,
  runGitPush,
} from '@core/features/source-control/api/browser/git-action-handlers';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import {
  getRegisteredTaskData,
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewScope } from '@core/features/tasks/contributions/scopes';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { openModal } from '@core/manifests/browser/modal-api';
import { normalizeBrowserUrl } from '@core/primitives/browser/api';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import {
  disabled,
  enabled,
  hidden,
  type CommandAvailability,
  type ViewScopeImpl,
} from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import type { ResolvedTab } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';

type TaskScopeParams = { readonly projectId: string; readonly taskId: string };

function taskAvailability(
  params: TaskScopeParams,
  predicate: () => boolean = () => true,
  reason = 'Command is unavailable'
): CommandAvailability {
  if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
  return predicate() ? enabled : disabled(reason);
}

function activeBrowser(params: TaskScopeParams) {
  const taskView = getTaskComposition(params.projectId, params.taskId);
  const tab = taskView?.activePane?.resolvedTabs.find(
    (candidate) => candidate.isActive && candidate.kind === 'browser'
  ) as ResolvedTab<BrowserTabResource> | undefined;
  const resource = tab?.resource as BrowserTabResource | undefined;
  return {
    resource,
    session: resource?.session ?? null,
  };
}

async function createConversation(params: TaskScopeParams, target?: 'right'): Promise<void> {
  const outcome = await openModal('createConversationModal', params);
  if (!outcome.success) return;
  const taskView = getTaskComposition(params.projectId, params.taskId);
  const { conversationId, type } = outcome.data;
  taskView?.paneLayout.open(
    type === 'acp' ? 'acp-chat' : 'conversation',
    { conversationId },
    target ? { preview: false, target } : { preview: false }
  );
  taskView?.setFocusedRegion('main');
}

/**
 * [XG-CUSTOM] 2026-10-06 —— `browser.openUrl`（「打开网址…」）的执行体。
 *
 * 两条入口：① 命令面板（Ctrl+K）选中 → 没有 url → 弹既有 modal 输入；
 *          ② 带 url 的 programmatic/menu 调用 → 直接用纯函数校验/决策。
 * 校验与决策都在 `@core/features/browser/browser/open-url-command`（纯函数，有单测），这里只做 UI + 开页；
 * 空/非法**如实提示**（toast），不静默、不回退系统浏览器。
 */
async function openUrlInTaskBrowser(params: TaskScopeParams, rawUrl?: string): Promise<void> {
  const plan = planOpenUrlCommand(typeof rawUrl === 'string' ? { url: rawUrl } : undefined);
  if (plan.kind === 'error') {
    toast.error('打开网址失败', { description: plan.message });
    return;
  }

  let url = plan.kind === 'open' ? plan.url : undefined;
  if (url === undefined) {
    const outcome = await openModal('openUrlModal');
    if (!outcome.success) return;
    url = outcome.data;
  }

  const taskView = getTaskComposition(params.projectId, params.taskId);
  if (!openUrlInBrowserPane(taskView, url)) {
    toast.error('打开网址失败', { description: '当前 task 还没准备好，请稍后再试' });
  }
}

const taskScopeImplementation = {
  // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（命令面板 Ctrl+K 触发）。
  //   带 url（programmatic/menu 调用）→ 直接按纯函数决策；不带 url（命令面板点进来的唯一形态）→ 弹输入框。
  //   开页**只走** paneLayout.open('browser', { initialUrl })，与 task.openBrowser / 预览 pill 同一条路：
  //   不新建 WebContentsView、不动 9223 桥白名单、不回退系统浏览器。
  'browser.openUrl': (params) => ({
    availability: () => taskAvailability(params),
    execute: (input) => {
      void openUrlInTaskBrowser(params, input?.url);
    },
  }),
  'task.newConversation': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void createConversation(params);
    },
  }),
  'task.newConversationSplitRight': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void createConversation(params, 'right');
    },
  }),
  'task.sidebarChanges': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      getTaskComposition(params.projectId, params.taskId)?.chrome.commands.toggleSidebarTab(
        'changes'
      );
    },
  }),
  'task.sidebarConversations': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      getTaskComposition(params.projectId, params.taskId)?.chrome.commands.toggleSidebarTab(
        'conversations'
      );
    },
  }),
  'task.sidebarFiles': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      getTaskComposition(params.projectId, params.taskId)?.chrome.commands.toggleSidebarTab(
        'files'
      );
    },
  }),
  'task.fileContentSearch': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (!taskView) return;
      taskView.chrome.commands.openSidebarTab('files');
      taskView.editorView.requestFileSearchFocus();
    },
  }),
  'task.viewTerminals': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      getTaskComposition(params.projectId, params.taskId)?.chrome.commands.openTerminalDrawer();
    },
  }),
  'task.toggleTerminalDrawer': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (!taskView) return;
      if (taskView.isTerminalDrawerOpen) {
        taskView.chrome.commands.closeTerminalDrawer();
      } else if (taskView.terminalTabs.tabs.length === 0) {
        void taskView.openNewTerminal();
      } else {
        taskView.chrome.commands.openTerminalDrawer();
      }
    },
  }),
  'task.toggleRightSidebar': (params) => ({
    availability: () => taskAvailability(params),
    presentation: () => {
      const collapsed = getTaskComposition(params.projectId, params.taskId)?.isSidebarCollapsed;
      return {
        title: collapsed ? 'Show Right Sidebar' : 'Hide Right Sidebar',
      };
    },
    execute: () => {
      getTaskComposition(params.projectId, params.taskId)?.chrome.commands.toggleSidebar();
    },
  }),
  'task.newTerminal': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      void getTaskComposition(params.projectId, params.taskId)?.openNewTerminal();
    },
  }),
  'task.openBrowser': (params) => ({
    availability: () => taskAvailability(params),
    execute: () => {
      const taskView = getTaskComposition(params.projectId, params.taskId);
      if (!taskView) return;
      // [XG-CUSTOM] 2026-10-06 —— 复用逻辑的**显式开关**：这个入口是人主动点「新开浏览器」，
      //   语义就是"再给我一个浏览器标签" ⇒ `reuseExisting: false`（唯一被显式关掉复用的入口）。
      //   另外它不带 url（开空白页），本来也就没有可导航的目标。
      openBrowserTabOrReuse(taskView, { reuseExisting: false });
      taskView.setFocusedRegion('main');
    },
  }),
  'task.browserGoBack': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(activeBrowser(params).session?.canGoBack),
        'Browser cannot go back'
      ),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (!resource) return;
      const adapter = browserControlsRegistry.get(resource.browserId)?.adapter;
      if (adapter?.canGoBack()) adapter.goBack();
    },
  }),
  'task.browserGoForward': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(activeBrowser(params).session?.canGoForward),
        'Browser cannot go forward'
      ),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (!resource) return;
      const adapter = browserControlsRegistry.get(resource.browserId)?.adapter;
      if (adapter?.canGoForward()) adapter.goForward();
    },
  }),
  'task.browserReload': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).resource), 'No active browser'),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (resource) browserControlsRegistry.get(resource.browserId)?.adapter?.reload();
    },
  }),
  'task.browserFocusUrl': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).resource), 'No active browser'),
    execute: () => {
      const { resource } = activeBrowser(params);
      if (resource) browserControlsRegistry.get(resource.browserId)?.focusUrl();
    },
  }),
  'task.browserOpenExternal': (params) => ({
    availability: () =>
      taskAvailability(params, () => Boolean(activeBrowser(params).session), 'No active browser'),
    execute: () => {
      const { session } = activeBrowser(params);
      if (!session) return;
      const normalized = normalizeBrowserUrl(session.currentUrl);
      if (normalized.ok && (normalized.protocol === 'http:' || normalized.protocol === 'https:')) {
        void openExternal(normalized.url);
      }
    },
  }),
  'task.browserCopyUrl': (params) => ({
    availability: () => {
      if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
      return activeBrowser(params).session ? enabled : hidden;
    },
    execute: () => {
      const { session } = activeBrowser(params);
      if (!session) return;
      const normalized = normalizeBrowserUrl(session.currentUrl, { allowSearchQueries: false });
      if (!normalized.ok) return;
      void navigator.clipboard
        .writeText(normalized.url)
        .then(() => toast('Browser URL copied'))
        .catch(() => toast.error('Could not copy browser URL'));
    },
  }),
  'task.gitFetch': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getGitRepositoryStore(params.projectId)),
        'No Git repository'
      ),
    execute: () => {
      const repository = getGitRepositoryStore(params.projectId);
      if (repository) void runGitFetch(repository);
    },
  }),
  'task.gitPull': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getTaskGitCheckoutStore(params.projectId, params.taskId)),
        'No Git checkout'
      ),
    execute: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      if (git) void runGitPull(git);
    },
  }),
  'task.gitPush': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => getTaskGitCheckoutStore(params.projectId, params.taskId)?.headKind === 'branch',
        'No branch is checked out'
      ),
    presentation: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      return git?.isPublished
        ? { title: 'Git Push', description: 'Push commits to remote' }
        : { title: 'Git Publish Branch', description: 'Publish this branch to remote' };
    },
    execute: () => {
      const git = getTaskGitCheckoutStore(params.projectId, params.taskId);
      if (!git) return;
      if (git.isPublished) {
        void runGitPush(git);
        return;
      }
      void runGitPublishCurrentBranch(git);
    },
  }),
  'task.pin': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => Boolean(getRegisteredTaskData(params.projectId, params.taskId)),
        'Task data is unavailable'
      ),
    presentation: () => {
      const task = getRegisteredTaskData(params.projectId, params.taskId);
      return task?.isPinned
        ? { title: 'Unpin Task', description: 'Remove this task from pinned' }
        : { title: 'Pin Task', description: 'Pin this task to keep it at the top' };
    },
    execute: () => {
      const task = getRegisteredTaskData(params.projectId, params.taskId);
      const taskStore = getTaskStore(params.projectId, params.taskId);
      if (task && taskStore) void taskStore.setPinned(!task.isPinned);
    },
  }),
  'task.archive': (params) => ({
    availability: () => {
      return taskAvailability(
        params,
        () => {
          const data = getRegisteredTaskData(params.projectId, params.taskId);
          return Boolean(data && !data.archivedAt);
        },
        'Task is already archived'
      );
    },
    execute: () => {
      void getTaskManagerStore(params.projectId)
        ?.archiveTask(params.taskId)
        .catch(() => toast.error('Could not archive task'));
    },
  }),
  'task.convertAutomation': (params) => ({
    availability: () => {
      if (getTaskStore(params.projectId, params.taskId)?.state !== 'provisioned') return hidden;
      return getRegisteredTaskData(params.projectId, params.taskId)?.type === 'automation-run'
        ? enabled
        : hidden;
    },
    execute: () => {
      void getTaskStore(params.projectId, params.taskId)?.convertAutomationTask();
    },
  }),
  'task.nextTask': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => {
          const entries = getSidebarStore().visibleTaskEntries;
          const index = entries.findIndex(
            (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
          );
          return index !== -1 && index < entries.length - 1;
        },
        'No next task'
      ),
    execute: () => {
      const entries = getSidebarStore().visibleTaskEntries;
      const index = entries.findIndex(
        (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
      );
      const next = entries[index + 1];
      if (next) getNavigation().navigate(taskViewDef(next));
    },
  }),
  'task.prevTask': (params) => ({
    availability: () =>
      taskAvailability(
        params,
        () => {
          const entries = getSidebarStore().visibleTaskEntries;
          return (
            entries.findIndex(
              (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
            ) > 0
          );
        },
        'No previous task'
      ),
    execute: () => {
      const entries = getSidebarStore().visibleTaskEntries;
      const index = entries.findIndex(
        (entry) => entry.projectId === params.projectId && entry.taskId === params.taskId
      );
      const previous = entries[index - 1];
      if (previous) getNavigation().navigate(taskViewDef(previous));
    },
  }),
} satisfies ViewScopeImpl<typeof taskViewScope>;

export function TaskScope({
  projectId,
  taskId,
  children,
}: {
  readonly projectId: string;
  readonly taskId: string;
  readonly children: ReactNode;
}) {
  const { instance } = useViewScope<typeof taskViewScope>(
    taskViewScope({ projectId, taskId }),
    taskScopeImplementation
  );

  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  if (!instance) return null;
  return <ViewScopeInstanceProvider instance={instance}>{children}</ViewScopeInstanceProvider>;
}
