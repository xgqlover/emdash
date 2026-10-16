import { shell, type BrowserWindow } from 'electron';
import { desktopHostEvents } from '@core/features/workbench/node';
import { isInternalAppUrl } from '@main/host/external-link-policy';
import { getMainWindow } from '@main/host/window';
import { log } from '@main/lib/logger';

/**
 * Ensure any external HTTP(S) links open in the user's default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
function requestExternalLinkOpen(url: string) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    desktopHostEvents.emit(undefined, { type: 'external-link-open-requested', url });
    return;
  }

  log.warn('External link request had no main window; opening directly', { url });
  shell.openExternal(url).catch((error: unknown) => {
    log.warn('Failed to open external link without main window', { url, error });
  });
}

/**
 * `rendererUrl` is the URL the main window was loaded from; only navigations to that origin
 * stay in-window. Local dev servers on other localhost ports are external links like any other.
 */
export function registerExternalLinkHandlers(win: BrowserWindow, rendererUrl: string) {
  const wc = win.webContents;

  // Handle window.open and target="_blank"
  wc.setWindowOpenHandler(({ url }) => {
    if (!isInternalAppUrl(url, rendererUrl) && /^https?:\/\//i.test(url)) {
      requestExternalLinkOpen(url);
      return { action: 'deny' };
    }
    // [XG-CUSTOM 2026-10-16] 兜底由 allow 改 deny：**非 http(s)（`file:` / 相对路径 /
    //   空串 / `app://xxx`）一律不开子窗**。这是"开出无参数 app 窗"的**唯一入口** ——
    //   它是 `7fbf04b50` 删掉 renderer 侧 `classifyLink` 后的症状放大器：本地路径链接
    //   走 `<a target="_blank">` 到这里被 allow ⇒ 开出一个 URL 带前缀的 `app://` 子窗 ⇒
    //   相对脚本解析错、JS 一行没跑 ⇒ 永远停在 `renderer/index.html` 的静态 splash
    //   （用户看到的"logo 浮窗"）。上游的 `will-navigate` 分支同样只放行 http(s)。
    return { action: 'deny' };
  });

  // Intercept navigations that would leave the app
  wc.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url, rendererUrl) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      requestExternalLinkOpen(url);
    }
  });
}
