import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { BrowserTabResource } from '@core/features/browser/api/browser/browser-tab-resource';
import { getBrowserClient } from '@core/features/browser/api/browser/client';
import { BrowserPane } from '@core/features/browser/browser/browser-pane';
import {
  getAppSettingValueSnapshot,
  setAppSettingsValueInCache,
  updateAppSettingsRequest,
} from '@core/features/settings/api/browser/app-settings-client';
import type { TaskTabContext } from '@core/features/workbench/api/browser/tabs/task-tab-context';
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
import { resolveOpenProfile } from './ensure-bot-browser-profile';

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
  // [XG-CUSTOM 2026-10-03] 请求方 bot（agent 的 `key=<botId>`）：设置里没绑 profile 时按需建
  // 一个 `bot-<botId>` 并绑上 —— 否则这一页落到 default，`/json/list` 里 `botId` 永远是空。
  botId?: string;
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
    // [XG-CUSTOM 2026-10-03] 例外只有一个：请求**显式带了 botId** 而设置里还没绑这个 bot →
    // 按需建 `bot-<botId>`（id 优先用主进程下发的那个）并落盘，见 ensure-bot-browser-profile.ts。
    const resolution = resolveOpenProfile({
      requestedProfileId: args.profileId,
      botId: args.botId,
      profiles: browserSettings?.profiles,
      defaultProfileId: browserSettings?.defaultProfileId,
    });
    if (resolution.createdProfile !== undefined && browserSettings !== undefined) {
      const created = resolution.createdProfile;
      const next = { ...browserSettings, profiles: [...browserSettings.profiles, created] };
      // 先更新缓存（同一 tick 里的 normalize/回归都能看到它），再异步落盘；
      // 落盘失败只 warn —— 这一页仍然用它自己的 partition 打开，不影响用户。
      setAppSettingsValueInCache('browser', next);
      void updateAppSettingsRequest('browser', next).catch((error: unknown) => {
        console.warn('[XG-CUSTOM] 按需建 bot 浏览器 profile 落盘失败（本页仍按该 profile 打开）', {
          botId: resolution.botId,
          profileId: created.id,
          error,
        });
      });
    }
    const session = browserSessionStore.createSession({
      projectId: taskCtx.projectId,
      workspaceId: taskCtx.workspaceId,
      taskId: taskCtx.taskId,
      profileId: resolution.profileId,
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
