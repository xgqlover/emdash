import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDiagnosticsStore } from '@core/features/browser/api/browser/browser-diagnostics-store';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { bindBrowserWebviewEvents } from './browser-webview-events';
import type { BrowserWebviewElement, BrowserWebviewEventMap } from './browser-webview-types';

class FakeBrowserWebview {
  url = 'about:blank';
  titleText = '';
  back = false;
  forward = false;
  readonly zoomFactors: number[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  canGoBack(): boolean {
    return this.back;
  }

  canGoForward(): boolean {
    return this.forward;
  }

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.titleText;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactors.push(factor);
  }

  addEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener as (event: unknown) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void {
    this.listeners.get(type)?.delete(listener as (event: unknown) => void);
  }

  emit(type: keyof BrowserWebviewEventMap, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function asWebview(fake: FakeBrowserWebview): BrowserWebviewElement {
  return fake as unknown as BrowserWebviewElement;
}

describe('bindBrowserWebviewEvents', () => {
  const disposers: (() => void)[] = [];

  function bindTrackedWebviewEvents(browserId: string, webview: BrowserWebviewElement) {
    const dispose = bindBrowserWebviewEvents(browserId, webview);
    disposers.push(dispose);
    return dispose;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
  });

  afterEach(() => {
    try {
      for (const dispose of disposers.splice(0)) dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates browser session state from webview events', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    webview.url = 'https://example.com/';
    webview.titleText = 'Example';
    webview.back = true;

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    browserSessionStore.updateSession(session.browserId, { zoomFactor: 1.25 });

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'about:blank',
      title: '',
      canGoBack: false,
      canGoForward: false,
    });

    webview.emit('dom-ready');
    expect(webview.zoomFactors).toEqual([1.25]);

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/',
      title: 'Example',
      canGoBack: true,
      canGoForward: false,
    });

    webview.emit('did-start-loading');
    expect(browserSessionStore.getSession(session.browserId)?.isLoading).toBe(true);

    webview.emit('did-navigate', { url: 'https://example.com/docs' });
    expect(webview.zoomFactors).toEqual([1.25, 1.25]);
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/docs',
      loadError: undefined,
    });

    webview.emit('page-title-updated', { title: 'Docs' });
    webview.emit('page-favicon-updated', { favicons: ['https://example.com/favicon.ico'] });
    webview.emit('console-message', {
      level: 3,
      message: 'Unhandled error token=secret',
      line: 42,
      sourceId: 'https://example.com/app.js',
    });
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      title: 'Docs',
      faviconUrl: 'https://example.com/favicon.ico',
    });

    webview.emit('did-start-loading');
    expect(browserSessionStore.getSession(session.browserId)?.faviconUrl).toBeUndefined();

    webview.emit('did-fail-load', {
      errorCode: -105,
      errorDescription: 'Name not resolved',
      validatedURL: 'https://missing.invalid/',
      isMainFrame: true,
    });
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      isLoading: false,
      loadError: {
        code: -105,
        description: 'Name not resolved',
        url: 'https://missing.invalid/',
      },
    });
    expect(browserDiagnosticsStore.entriesForBrowser(session.browserId)).toMatchObject([
      {
        level: 'error',
        source: 'console',
        message: 'Unhandled error token=[REDACTED]',
        line: 42,
      },
      {
        level: 'error',
        source: 'navigation',
        message: 'Name not resolved',
        url: 'https://missing.invalid/',
      },
    ]);
  });

  it.each([false, true])(
    'only treats main-frame failures as page errors (isMainFrame: %s)',
    (isMainFrame) => {
      const session = browserSessionStore.createSession({
        browserId: 'browser-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      });
      const webview = new FakeBrowserWebview();
      webview.url = 'http://localhost:3000/';
      webview.titleText = 'Healthy parent';
      bindTrackedWebviewEvents(session.browserId, asWebview(webview));
      webview.emit('dom-ready');
      webview.emit('did-start-loading');
      webview.emit('did-navigate', { url: webview.url });

      webview.emit('did-fail-load', {
        errorCode: -102,
        errorDescription: 'ERR_CONNECTION_REFUSED',
        validatedURL: 'http://localhost:3001/unavailable',
        isMainFrame,
      });

      const loadError = isMainFrame
        ? {
            code: -102,
            description: 'ERR_CONNECTION_REFUSED',
            url: 'http://localhost:3001/unavailable',
          }
        : undefined;
      expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
        isLoading: !isMainFrame,
        loadError,
      });

      webview.emit('did-stop-loading');
      expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
        currentUrl: 'http://localhost:3000/',
        title: 'Healthy parent',
        isLoading: false,
        loadError,
      });
      expect(browserDiagnosticsStore.entriesForBrowser(session.browserId)).toMatchObject([
        {
          level: 'error',
          source: 'navigation',
          message: 'ERR_CONNECTION_REFUSED',
          url: 'http://localhost:3001/unavailable',
        },
      ]);
    }
  );

  it.each([false, true])('ignores cancelled loads (isMainFrame: %s)', (isMainFrame) => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('did-start-loading');
    const beforeFailure = browserSessionStore.getSnapshot(session.browserId);

    webview.emit('did-fail-load', {
      errorCode: -3,
      errorDescription: 'ERR_ABORTED',
      validatedURL: 'http://localhost:3000/cancelled',
      isMainFrame,
    });

    expect(browserSessionStore.getSnapshot(session.browserId)).toEqual(beforeFailure);
    expect(browserDiagnosticsStore.entriesForBrowser(session.browserId)).toEqual([]);
  });

  it('reapplies the session zoom after navigation commits', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    browserSessionStore.updateSession(session.browserId, { zoomFactor: 1.5 });
    const webview = new FakeBrowserWebview();

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('dom-ready');
    webview.emit('did-navigate', { url: 'https://example.com/' });
    webview.emit('did-stop-loading');

    expect(webview.zoomFactors).toEqual([1.5, 1.5, 1.5]);
  });

  it('removes listeners and pending history updates when disposed', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    const dispose = bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('dom-ready');
    webview.emit('did-navigate', { url: 'https://example.com/docs' });
    expect(vi.getTimerCount()).toBe(3);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    webview.back = true;
    webview.emit('dom-ready');
    webview.emit('did-start-loading');
    await vi.advanceTimersByTimeAsync(200);

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      isLoading: false,
      canGoBack: false,
      currentUrl: 'https://example.com/docs',
    });
  });

  it('does not read webview state before dom-ready', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    webview.getURL = () => {
      throw new Error('not ready');
    };

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('did-stop-loading');
    webview.emit('did-navigate', { url: 'https://example.com/' });

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'about:blank',
      title: '',
    });
  });

  it('ignores Electron internal security warnings', () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('console-message', {
      level: 2,
      message: '%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold;',
      line: 1,
      sourceId: 'node:electron/js2c/sandbox_bundle',
    });

    expect(browserDiagnosticsStore.entriesForBrowser(session.browserId)).toEqual([]);
  });

  it('refreshes history state after navigation commits', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    webview.url = 'https://example.com/';

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('dom-ready');
    webview.emit('did-navigate', { url: 'https://example.com/docs' });
    expect(browserSessionStore.getSession(session.browserId)?.canGoBack).toBe(false);

    webview.url = 'https://example.com/docs';
    webview.back = true;
    await vi.runOnlyPendingTimersAsync();

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/docs',
      canGoBack: true,
    });
  });

  it('refreshes history state when Electron updates navigation entries after load events', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });
    const webview = new FakeBrowserWebview();
    webview.url = 'https://example.com/';

    bindTrackedWebviewEvents(session.browserId, asWebview(webview));
    webview.emit('dom-ready');
    webview.emit('did-navigate', { url: 'https://example.com/docs' });
    webview.url = 'https://example.com/docs';
    webview.emit('did-stop-loading');

    await vi.advanceTimersByTimeAsync(0);
    expect(browserSessionStore.getSession(session.browserId)?.canGoBack).toBe(false);

    webview.back = true;
    await vi.advanceTimersByTimeAsync(50);

    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'https://example.com/docs',
      canGoBack: true,
    });
  });

  // ── [XG-CUSTOM] 2026-10-06 —— 早绑定钩子 ───────────────────────────────────────
  //
  // 病根（真机事故 2026-10-06）：内嵌页进 9223 白名单的唯一入口是 `bindWebContents`，旧实现只在
  // `dom-ready` 里调 ⇒ 加载慢/失败时 `dom-ready` 迟迟不来就**永远不绑**，`/json/list` 恒空，
  // 桥把"页其实开出来了"误报成"没开出来"。这几条钉住：所有早于 dom-ready 的时机都会叫钩子。
  describe('[XG-CUSTOM] 早绑定钩子 onEarlyBind', () => {
    function bindWithEarlyBind(browserId: string, webview: BrowserWebviewElement) {
      const onEarlyBind = vi.fn();
      const dispose = bindBrowserWebviewEvents(browserId, webview, { onEarlyBind });
      disposers.push(dispose);
      return onEarlyBind;
    }

    it('每个早于 dom-ready 的时机都叫一次钩子（慢页/失败页也能绑上）', () => {
      const webview = new FakeBrowserWebview();
      const onEarlyBind = bindWithEarlyBind('browser-early', asWebview(webview));

      expect(onEarlyBind).not.toHaveBeenCalled();

      webview.emit('did-start-loading');
      expect(onEarlyBind).toHaveBeenCalledTimes(1);

      webview.emit('did-attach');
      expect(onEarlyBind).toHaveBeenCalledTimes(2);

      // 主框架失败（死域名 / 代理坏）→ 也要绑：错误页同样是一个已 attach 的 webview
      webview.emit('did-fail-load', {
        errorCode: -105,
        errorDescription: 'net::ERR_NAME_NOT_RESOLVED',
        validatedURL: 'https://j-designcenter.com/',
        isMainFrame: true,
      });
      expect(onEarlyBind).toHaveBeenCalledTimes(3);

      webview.emit('did-finish-load');
      webview.emit('did-stop-loading');
      expect(onEarlyBind).toHaveBeenCalledTimes(5);
    });

    it('已取消的加载（errorCode -3）也走一次钩子', () => {
      const webview = new FakeBrowserWebview();
      const onEarlyBind = bindWithEarlyBind('browser-cancelled', asWebview(webview));

      webview.emit('did-fail-load', {
        errorCode: -3,
        errorDescription: 'ERR_ABORTED',
        validatedURL: 'https://example.com/',
        isMainFrame: true,
      });

      expect(onEarlyBind).toHaveBeenCalledTimes(1);
    });

    it('钩子抛错只 console.warn，绝不影响页面事件处理本身', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const webview = new FakeBrowserWebview();
        const session = browserSessionStore.createSession({
          browserId: 'browser-throws',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          taskId: 'task-1',
        });
        const dispose = bindBrowserWebviewEvents(session.browserId, asWebview(webview), {
          onEarlyBind: () => {
            throw new Error('绑定器炸了');
          },
        });
        disposers.push(dispose);

        expect(() => webview.emit('did-start-loading', {})).not.toThrow();
        expect(warn).toHaveBeenCalled();
        // 页面状态同步照常发生（抛错被就地吞掉）
        expect(browserSessionStore.getSession(session.browserId)?.isLoading).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it('dispose 之后不再叫钩子（也不会漏监听）', () => {
      const webview = new FakeBrowserWebview();
      const onEarlyBind = bindWithEarlyBind('browser-dispose', asWebview(webview));
      webview.emit('did-attach');
      expect(onEarlyBind).toHaveBeenCalledTimes(1);

      disposers.splice(0).forEach((dispose) => dispose());
      webview.emit('did-attach');
      webview.emit('did-start-loading');
      expect(onEarlyBind).toHaveBeenCalledTimes(1);
    });
  });
});
