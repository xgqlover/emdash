import { browserDiagnosticsStore } from '@core/features/browser/api/browser/browser-diagnostics-store';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { BROWSER_DEFAULT_URL, normalizeBrowserZoomFactor } from '@core/primitives/browser/api';
import type { BrowserWebviewElement, BrowserWebviewEventMap } from './browser-webview-types';

export function bindBrowserWebviewEvents(
  browserId: string,
  webview: BrowserWebviewElement,
  options: {
    onDomReady?: () => void;
    /**
     * [XG-CUSTOM] 2026-10-06 —— 早绑定钩子：在 `dom-ready` **之前**的每个可用时机都调一次
     * （`did-start-loading` / `did-attach` / `did-fail-load` / `did-finish-load` / `did-stop-loading`）。
     *
     * 病根：内嵌页进 9223 CDP 白名单的唯一入口是 `bindWebContents`，而它旧实现只在
     * `dom-ready` 里调 —— 页面加载慢/失败（没有 document、dom-ready 迟迟不来）时**永远不绑**，
     * `/json/list` 恒空 ⇒ 桥把"页其实开出来了"误报成"没开出来"（真机事故 2026-10-06）。
     *
     * 这里只负责**尽早、多次**地叫这个钩子；幂等 / 退避重试 / 只 warn 不抛都在被调方
     * （`browser-webview-bind.ts::createWebviewWebContentsBinder`）。
     * 钩子抛错也只 `console.warn` —— 尽力而为的自动路径，不能影响页面事件处理本身。
     */
    onEarlyBind?: () => void;
  } = {}
): () => void {
  let isDomReady = false;
  const historySyncTimers = new Set<ReturnType<typeof setTimeout>>();

  const syncHistoryState = () => {
    if (!isDomReady) return;
    const currentUrl = webview.getURL() || BROWSER_DEFAULT_URL;
    browserSessionStore.updateSession(browserId, {
      currentUrl,
      title: webview.getTitle(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    });
  };

  const scheduleHistoryStateSync = () => {
    for (const timer of historySyncTimers) clearTimeout(timer);
    historySyncTimers.clear();

    for (const delay of [0, 50, 200]) {
      const timer = setTimeout(() => {
        historySyncTimers.delete(timer);
        syncHistoryState();
      }, delay);
      historySyncTimers.add(timer);
    }
  };

  const scheduleHistoryStateSyncOnce = () => {
    const timer = setTimeout(() => {
      historySyncTimers.delete(timer);
      syncHistoryState();
    }, 0);
    historySyncTimers.add(timer);
  };

  const applySessionZoom = () => {
    const session = browserSessionStore.getSession(browserId);
    if (session?.zoomFactor === undefined) return;
    webview.setZoomFactor(normalizeBrowserZoomFactor(session.zoomFactor));
  };

  const onDomReady = () => {
    isDomReady = true;
    applySessionZoom();
    syncHistoryState();
    options.onDomReady?.();
  };

  // [XG-CUSTOM] 2026-10-06 —— 早绑定：每个早于/晚于 dom-ready 的事件都给一次机会。
  // 单独 try/catch：钩子（绑定器）必须"绝不抛"，这里再兜一层，保证页面状态同步不受影响。
  const runEarlyBind = (
    trigger:
      | 'did-attach'
      | 'did-start-loading'
      | 'did-fail-load'
      | 'did-finish-load'
      | 'did-stop-loading'
  ) => {
    try {
      options.onEarlyBind?.();
    } catch (error) {
      console.warn(`[XG-CUSTOM] 内嵌浏览器早绑定钩子抛错（trigger=${trigger}，已忽略）`, error);
    }
  };

  const onEarlyAttach = () => runEarlyBind('did-attach');
  const onFinishLoad = () => runEarlyBind('did-finish-load');

  const onStartLoading = () => {
    runEarlyBind('did-start-loading');
    browserSessionStore.updateSession(browserId, {
      faviconUrl: null,
      isLoading: true,
      loadError: null,
    });
  };

  const onStopLoading = () => {
    runEarlyBind('did-stop-loading');
    if (!isDomReady) return;
    const currentUrl = webview.getURL() || BROWSER_DEFAULT_URL;
    browserSessionStore.updateSession(browserId, {
      isLoading: false,
      currentUrl,
      title: webview.getTitle(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    });
    applySessionZoom();
    scheduleHistoryStateSyncOnce();
  };

  const onNavigate = (event: { url: string }) => {
    if (!isDomReady) return;
    browserSessionStore.updateSession(browserId, {
      currentUrl: event.url,
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
      loadError: null,
    });
    applySessionZoom();
    scheduleHistoryStateSync();
  };

  const onFailLoad = (event: BrowserWebviewEventMap['did-fail-load']) => {
    // [XG-CUSTOM] 2026-10-06 —— 失败页同样要绑（error page 也是一个已 attach 的 webview）：
    // 放在 -3 提前 return 之前，保证"取消的加载"也走一次早绑定。
    runEarlyBind('did-fail-load');
    if (event.errorCode === -3) return;
    if (event.isMainFrame) {
      browserSessionStore.updateSession(browserId, {
        isLoading: false,
        loadError: {
          code: event.errorCode,
          description: event.errorDescription,
          url: event.validatedURL,
        },
      });
    }
    browserDiagnosticsStore.append({
      browserId,
      level: 'error',
      source: 'navigation',
      message: event.errorDescription,
      url: event.validatedURL,
    });
  };

  const onConsoleMessage = (event: {
    level: number;
    message: string;
    line: number;
    sourceId: string;
  }) => {
    if (!shouldRecordConsoleDiagnostic(event)) return;
    browserDiagnosticsStore.append({
      browserId,
      level: consoleLevelToDiagnosticsLevel(event.level),
      source: 'console',
      message: event.message,
      url: event.sourceId,
      line: event.line,
    });
  };

  const onTitle = (event: { title: string }) => {
    browserSessionStore.updateSession(browserId, { title: event.title });
  };

  const onFavicon = (event: { favicons: string[] }) => {
    browserSessionStore.updateSession(browserId, { faviconUrl: event.favicons[0] });
  };

  webview.addEventListener('dom-ready', onDomReady);
  // [XG-CUSTOM] 2026-10-06 —— 早绑定钩子（都早于 dom-ready；详见 options.onEarlyBind 注释）
  webview.addEventListener('did-attach', onEarlyAttach);
  webview.addEventListener('did-finish-load', onFinishLoad);
  webview.addEventListener('did-start-loading', onStartLoading);
  webview.addEventListener('did-stop-loading', onStopLoading);
  webview.addEventListener('did-navigate', onNavigate);
  webview.addEventListener('did-navigate-in-page', onNavigate);
  webview.addEventListener('did-fail-load', onFailLoad);
  webview.addEventListener('console-message', onConsoleMessage);
  webview.addEventListener('page-title-updated', onTitle);
  webview.addEventListener('page-favicon-updated', onFavicon);

  return () => {
    for (const timer of historySyncTimers) clearTimeout(timer);
    historySyncTimers.clear();
    webview.removeEventListener('dom-ready', onDomReady);
    webview.removeEventListener('did-attach', onEarlyAttach);
    webview.removeEventListener('did-finish-load', onFinishLoad);
    webview.removeEventListener('did-start-loading', onStartLoading);
    webview.removeEventListener('did-stop-loading', onStopLoading);
    webview.removeEventListener('did-navigate', onNavigate);
    webview.removeEventListener('did-navigate-in-page', onNavigate);
    webview.removeEventListener('did-fail-load', onFailLoad);
    webview.removeEventListener('console-message', onConsoleMessage);
    webview.removeEventListener('page-title-updated', onTitle);
    webview.removeEventListener('page-favicon-updated', onFavicon);
  };
}

function consoleLevelToDiagnosticsLevel(level: number) {
  if (level >= 3) return 'error';
  if (level === 2) return 'warning';
  return 'info';
}

function shouldRecordConsoleDiagnostic(event: { message: string; sourceId: string }): boolean {
  if (!event.sourceId.startsWith('node:electron/')) return true;
  return !event.message.includes('Electron Security Warning');
}
