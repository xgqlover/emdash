import { webContents } from 'electron';
import {
  browserProfilePartition,
  DEFAULT_BROWSER_PROFILE_ID,
  isBrowserDataClearKind,
  isBrowsingDataKind,
  type BrowserDataClearKind,
} from '@core/primitives/browser/api';
import { getAppSettingsService } from '@main/bootstrap/core/service-instances';
import { configureBrowserProfileSession } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
// [XG-CUSTOM 2026-10-12] 「从零开页」回执的落地点 + 开成之后把主窗提上来（只在用户看不见时）
import { settleEmbeddedBrowserOpenResult } from '@main/host/browser/embedded-browser-open-ack';
import { isBrowserPartition } from '@main/host/browser/webview-security';
// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
import { revealMainWindowIfHidden } from '@main/host/window';

export const browserOperations = {
  registerSession: (args: { browserId: string; partition: string }) => {
    if (!args.browserId.trim() || !isBrowserPartition(args.partition)) {
      return { success: false as const, error: 'Invalid browser session' };
    }
    configureBrowserProfileSession(args.partition);
    browserWebContentsRegistry.registerSession(args);
    return { success: true as const };
  },

  unregisterSession: (browserId: string) => {
    browserWebContentsRegistry.unregisterSession(browserId);
    return { success: true as const };
  },

  bindWebContents: (args: { browserId: string; webContentsId: number }) => {
    const target = webContents.fromId(args.webContentsId);
    if (!target || target.isDestroyed()) {
      return { success: false as const };
    }
    return { success: browserWebContentsRegistry.bindWebContents(args.browserId, target) };
  },

  setActiveBrowser: (browserId: string | null) => {
    browserWebContentsRegistry.setActiveBrowser(browserId);
    return { success: true as const };
  },

  getActiveBrowser: () => ({ browserId: browserWebContentsRegistry.getActiveBrowser() }),

  openDevTools: (browserId: string) => ({
    success: import.meta.env.DEV && browserWebContentsRegistry.openDevTools(browserId),
  }),

  captureScreenshot: async (browserId: string) => ({
    success: await browserWebContentsRegistry.captureScreenshotToClipboard(browserId),
  }),

  clearData: async (browserId: string, kind: BrowserDataClearKind) => {
    if (!isBrowserDataClearKind(kind)) {
      return { success: false as const, error: 'Invalid browser data clear kind' };
    }
    return { success: await browserWebContentsRegistry.clearData(browserId, kind) };
  },

  clearProfileStorage: async (profileId: string) => ({
    success: await browserWebContentsRegistry.clearProfileStorage(profileId),
  }),

  clearBrowsingData: async (kind: string) => {
    if (!isBrowsingDataKind(kind)) {
      return { success: false as const, error: 'Invalid browsing data kind' };
    }
    const partitions = await collectBrowserPartitions();
    return { success: await browserWebContentsRegistry.clearBrowsingData(kind, partitions) };
  },

  // [XG-CUSTOM 2026-10-12] 「从零开页」的回执（主窗口渲染进程 → 主进程）。两件事，都很窄：
  //   ① 落地等待中的结果（球那边就能拿到真实的 `{ok:false, reason}` —— 原来失败完全静默）；
  //   ② **只在这一页真的开成时**，把主窗提上来 —— 且只在主窗**用户看不见**（隐藏/最小化）时，
  //      并且不抢焦点（见 `revealMainWindowIfHidden` 的注释）。为什么：球里点一下链接，
  //      页开在隐藏的主窗里 = 屏幕上什么都没发生（真机事故就是这么来的）。
  //   `accepted=false`（已超时/重复/伪造 id）⇒ 什么都不做，免得重复揭示窗口。
  reportEmbeddedBrowserOpenResult: (args: { requestId: string; ok: boolean; reason?: string }) => {
    const accepted = settleEmbeddedBrowserOpenResult(args.requestId, {
      ok: args.ok,
      ...(typeof args.reason === 'string' ? { reason: args.reason } : {}),
    });
    if (accepted && args.ok) revealMainWindowIfHidden();
    return { accepted };
  },
};

// Every persistent profile partition (default + named) plus any partitions with
// live sessions, so clearing browsing data covers isolated-per-task tabs too.
async function collectBrowserPartitions(): Promise<string[]> {
  const browserSettings = await getAppSettingsService().get('browser');
  const partitions = new Set<string>([browserProfilePartition(DEFAULT_BROWSER_PROFILE_ID)]);
  for (const profile of browserSettings.profiles) {
    partitions.add(browserProfilePartition(profile.id));
  }
  for (const partition of browserWebContentsRegistry.registeredPartitions) {
    partitions.add(partition);
  }
  return [...partitions];
}
