import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { BrowserTabResource } from '@core/features/browser/api/browser/browser-tab-resource';
import { getBrowserClient } from '@core/features/browser/api/browser/client';
import { BrowserPane } from '@core/features/browser/browser/browser-pane';
import { getAppSettingValueSnapshot } from '@core/features/settings/api/browser/app-settings-client';
import type { TaskTabContext } from '@core/features/workbench/api/browser/tabs/task-tab-context';
import { normalizeBrowserProfileSelection } from '@core/primitives/browser/api';
import type { BrowserSessionSnapshot } from '@core/primitives/browser/api';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabContentProps,
  ResolvedTab,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import { createTabProvider } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import { BrowserTabBarItem, BrowserTabBarItemDragPreview } from './browser-tab-item';

export interface BrowserState {
  browserId: string;
  /** Session snapshot — kept current by BrowserTabResource's MobX reaction. */
  session: BrowserSessionSnapshot;
}

export interface BrowserOpenArgs {
  initialUrl?: string;
  // [XG-CUSTOM] bot ⟷ profile：主进程按 bot 解析好的 profile（不带 = 用 defaultProfileId，
  // 与改动前一致）。见 core/primitives/browser/api 的 resolveBotBrowserProfileId。
  profileId?: string;
}

/**
 * Mounts BrowserPane for every open browser tab; visibility is managed via
 * visibility:hidden + inert so browser sessions survive tab switches.
 * When no browser tab is active, calls setActiveBrowser(null) so the browser
 * process stops responding to commands.
 */
const BrowserTabContent = observer(function BrowserTabContent({ host }: TabContentProps) {
  const browserTabs = host.resolvedTabs.filter(
    (t): t is ResolvedTab<BrowserTabResource> => t.kind === 'browser'
  );
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeBrowserId =
    activeTab?.kind === 'browser' ? (activeTab.resource as BrowserTabResource).browserId : null;

  useEffect(() => {
    if (activeBrowserId !== null) return;
    void getBrowserClient().then((client) => client.setActiveBrowser({ browserId: null }));
  }, [activeBrowserId]);

  return (
    <>
      {browserTabs.map((tab) => {
        const browserId = tab.resource.browserId;
        const visible = activeBrowserId === browserId;
        return (
          <div
            key={browserId}
            className="absolute inset-0"
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — `inert` is a valid HTML attribute in modern browsers but not yet in React types
            inert={visible ? undefined : ''}
          >
            <BrowserPane browserId={browserId} visible={visible} />
          </div>
        );
      })}
    </>
  );
});

export const browserTabProvider: TabProvider<
  'browser',
  BrowserState,
  BrowserTabResource,
  BrowserOpenArgs
> = createTabProvider({
  kind: 'browser',
  resourceKey: (s: BrowserState) => s.browserId,

  // No mount: multi. Each open creates a fresh browser session.

  /**
   * Creates a new browser session and returns it as the initial state.
   * Returns null to abort if session creation fails (shouldn't happen).
   */
  onBeforeOpen(args: BrowserOpenArgs, ctx: TabViewContext): BrowserState | null {
    const taskCtx = ctx as TaskTabContext;
    const browserSettings = getAppSettingValueSnapshot('browser');
    // [XG-CUSTOM] 请求里指定了 profile（agent 按 bot 解析来的）就用它 —— 但必须已经存在，
    // 否则 normalize 会退回 defaultProfileId（不给"凭空造一个 profile"的后门）。
    const requestedProfileId =
      typeof args.profileId === 'string' && args.profileId !== ''
        ? args.profileId
        : browserSettings?.defaultProfileId;
    const profileId = normalizeBrowserProfileSelection(
      requestedProfileId,
      browserSettings?.profiles
    );
    const session = browserSessionStore.createSession({
      projectId: taskCtx.projectId,
      workspaceId: taskCtx.workspaceId,
      taskId: taskCtx.taskId,
      profileId,
      initialUrl: args.initialUrl,
    });
    return { browserId: session.browserId, session };
  },

  initialize(
    entry: TabEntry<BrowserState>,
    handle: TabHandle,
    _ctx: TabViewContext
  ): BrowserTabResource {
    return new BrowserTabResource(entry, handle);
  },

  dispose(_entry: TabEntry<BrowserState>, resource: BrowserTabResource): void {
    resource.dispose();
  },

  TabBarItem: BrowserTabBarItem,
  TabBarItemDragPreview: BrowserTabBarItemDragPreview,
  TabContent: BrowserTabContent,
});
