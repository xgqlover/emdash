import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]
import { Clock, FolderInput, Inbox, MessageSquareShare, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { handoffViewDef } from '@core/features/handoff/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { WORKBENCH_BOTTOM_BAR_HEIGHT_PX } from '@core/primitives/layouts/api/workbench-layout';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { ProjectsGroupLabel } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSearchTrigger } from './sidebar-search-trigger';
import { SidebarSpace } from './sidebar-space';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();

  // [XG-CUSTOM] 「🧠 项我」→ 原生 task + conversation（ACP），用 emdash 原生聊天窗
  const openXiangwoMain = async () => {
    const projectId = 'xiangwo';
    const taskId = 'xiangwo-main';
    const manager = getTaskManagerStore(projectId);
    if (!manager) {
      navigate(taskViewDef({ projectId, taskId }));
      return;
    }
    if (!manager.tasks.has(taskId)) {
      await manager.createTask({
        id: taskId,
        projectId,
        taskConfig: {
          version: '1',
          name: '项我',
          initialConversation: {
            id: 'xiangwo-main-conv',
            provider: 'xiangwo',
            title: '项我主对话',
            type: 'acp',
          },
        },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: {
            kind: 'repository-instance',
            workspaceId: 'repository:/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo-workspace',
          },
        },
      });
    }
    navigate(taskViewDef({ projectId, taskId }));
  };
  const { currentView } = useWorkspaceSlots();

  const openFeedbackModal = useOpenModal('feedbackModal');
  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  return (
    <div
      className={cn(
        // Closed = unmounted (store-driven conditional rendering), so the
        // border applies unconditionally.
        'surface-sunken relative flex h-full flex-col border-r border-border bg-(--em-surface) text-foreground-tertiary-muted transition-colors',
        isDragOver && 'bg-accent/10 ring-2 ring-inset ring-accent/50'
      )}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background-tertiary/80 backdrop-blur-sm">
          <FolderInput className="size-8 text-foreground" />
          <span className="text-xs font-medium text-foreground">{t('drop_to_add_project')}</span>
        </div>
      )}
      <SidebarSpace />
      <SidebarContainer className="min-h-0 w-full flex-1 border-r-0">
        <SidebarContent className="flex flex-col">
          <SidebarPinnedTaskList />
          <SidebarGroup className="mb-0 flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => void openXiangwoMain()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-secondary"
            >
              <span aria-hidden="true">🧠</span>
              <span className="truncate">项我</span>
            </button>
            <ProjectsGroupLabel />
            <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
              <SidebarMenu className="flex min-h-0 flex-1 flex-col">
                <SidebarVirtualList />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarSearchTrigger />
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'handoff')}
              onClick={() => navigate(handoffViewDef())}
              aria-label="交接台"
              className="w-full justify-between"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Inbox className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">交接台</span>
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'automations')}
              onClick={() => navigate(automationsViewDef())}
              aria-label={t('automations')}
              className="w-full justify-between"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Clock className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">{t('automations')}</span>
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate(settingsViewDef())}
              aria-label={t('settings')}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                {t('settings')}
              </span>
              <BoundShortcut command="app.settings" variant="keycaps" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3"
          style={{ height: WORKBENCH_BOTTOM_BAR_HEIGHT_PX }}
        >
          <button
            type="button"
            className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-foreground-muted focus:outline-none focus-visible:outline-none"
            onClick={() => void openFeedbackModal({})}
          >
            <MessageSquareShare className="size-4 shrink-0" />
            <span className="truncate">{t('give_feedback')}</span>
          </button>
          <UpdateSection />
        </div>
      </SidebarContainer>
    </div>
  );
});
