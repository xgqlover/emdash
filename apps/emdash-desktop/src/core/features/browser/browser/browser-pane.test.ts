import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { BrowserPane } from './browser-pane';

const browserRpc = vi.hoisted(() => ({
  bindWebContents: vi.fn(),
  registerSession: vi.fn(),
  setActiveBrowser: vi.fn(),
}));

vi.mock('@core/features/workbench/api/browser/task-composition-context', () => ({
  usePreviewServers: () => ({ urls: [] }),
}));

vi.mock('@core/primitives/workbench-shell/browser/tabs/pane-context', () => ({
  usePaneContext: () => ({
    pane: { setNextTabActive: vi.fn(), setPreviousTabActive: vi.fn() },
  }),
}));

vi.mock('@core/features/browser/api/browser/client', () => ({
  getBrowserClient: async () => browserRpc,
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({
    events: {
      subscribe: vi.fn(async () => () => {}),
    },
  }),
}));

vi.mock('./browser-toolbar', async () => {
  const React = await import('react');
  return {
    BrowserToolbar: ({ onNavigate }: { onNavigate?: (url: string) => boolean }) =>
      React.createElement('button', { onClick: () => onNavigate?.('https://linkedin.com/') }),
  };
});

describe('BrowserPane', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    browserSessionStore.clear();
    browserRpc.registerSession.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    browserSessionStore.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('does not load the submitted URL twice when the webview becomes ready', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const webview = container.querySelector<HTMLElement>('webview')!;
    const loadURL = vi.fn();
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'LinkedIn',
      getURL: () => webview.getAttribute('src'),
      getWebContentsId: () => 123,
      loadURL,
      setZoomFactor: vi.fn(),
    });

    await act(async () => webview.dispatchEvent(new dom.window.Event('dom-ready')));

    expect(webview.getAttribute('src')).toBe('https://linkedin.com/');
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('keeps the healthy page mounted when an iframe fails to load', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'http://localhost:3000/',
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });

    const webview = container.querySelector<HTMLElement>('webview')!;
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'Healthy parent',
      getURL: () => 'http://localhost:3000/',
      getWebContentsId: () => 123,
      setZoomFactor: vi.fn(),
    });

    await act(async () => {
      webview.dispatchEvent(new Event('dom-ready'));
      webview.dispatchEvent(new Event('did-start-loading'));
      webview.dispatchEvent(
        Object.assign(new Event('did-navigate'), { url: 'http://localhost:3000/' })
      );
    });
    await act(async () => {
      webview.dispatchEvent(
        Object.assign(new Event('did-fail-load'), {
          errorCode: -102,
          errorDescription: 'ERR_CONNECTION_REFUSED',
          validatedURL: 'http://localhost:3001/missing-frame',
          isMainFrame: false,
        })
      );
    });

    expect(container.querySelector('webview')).toBe(webview);

    await act(async () => webview.dispatchEvent(new Event('did-stop-loading')));

    expect(container.querySelector('webview')).toBe(webview);
    expect(container.querySelector('h1')).toBeNull();
    expect(browserSessionStore.getSession(session.browserId)).toMatchObject({
      currentUrl: 'http://localhost:3000/',
      title: 'Healthy parent',
      isLoading: false,
      loadError: undefined,
    });
  });

  it('renders a minimal load error state', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'https://missing.invalid/',
    });
    browserSessionStore.updateSession(session.browserId, {
      isLoading: false,
      loadError: {
        code: -105,
        description: 'net::ERR_NAME_NOT_RESOLVED',
        url: 'https://missing.invalid/',
      },
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });

    expect(container.querySelector('h1')?.textContent).toBe("This site can't be reached");
    expect(container.querySelector('p')?.textContent).toBe(
      "missing.invalid's server IP address could not be found. (ERR_NAME_NOT_RESOLVED)"
    );
    expect(container.textContent).not.toContain('Try:');
    expect(
      Array.from(container.querySelectorAll('button'))
        .map((button) => button.textContent)
        .filter(Boolean)
    ).toEqual(['Reload', 'Open externally']);
  });

  // ── [XG-CUSTOM] 2026-10-06 —— 早绑定（真机事故：页面开出来了却不在 /json/list）──────
  //
  // 内嵌页进 9223 CDP 白名单的唯一入口是 `bindWebContents`；旧实现只在 `dom-ready` 里调，
  // 加载慢/失败时 `dom-ready` 迟迟不来 ⇒ `/json/list` 恒空 ⇒ 桥误报「30s 内没有页面被绑定」。
  it('[XG-CUSTOM] 早绑定：did-start-loading 就 bindWebContents，不必等 dom-ready', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'https://slow.example.com/',
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });

    const webview = container.querySelector<HTMLElement>('webview')!;
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => 'Slow',
      getURL: () => 'https://slow.example.com/',
      getWebContentsId: () => 456,
      setZoomFactor: vi.fn(),
    });

    // 只发 did-start-loading（模拟"连接挂住"：没有 dom-ready、也没有 did-fail-load）
    await act(async () => webview.dispatchEvent(new dom.window.Event('did-start-loading')));

    expect(browserRpc.bindWebContents).toHaveBeenCalledTimes(1);
    expect(browserRpc.bindWebContents).toHaveBeenCalledWith({
      browserId: 'browser-1',
      webContentsId: 456,
    });

    // 幂等：后续事件（did-attach / dom-ready / did-finish-load）不会重复绑
    await act(async () => {
      webview.dispatchEvent(new dom.window.Event('did-attach'));
      webview.dispatchEvent(new dom.window.Event('dom-ready'));
      webview.dispatchEvent(new dom.window.Event('did-finish-load'));
    });
    expect(browserRpc.bindWebContents).toHaveBeenCalledTimes(1);
  });

  it('[XG-CUSTOM] 早绑定：RPC reject 只 warn，不把渲染进程搞崩', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = browserSessionStore.createSession({
        browserId: 'browser-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        initialUrl: 'https://example.com/',
      });
      browserRpc.bindWebContents.mockRejectedValueOnce(new Error('wire down'));

      await act(async () => {
        root.render(
          React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
        );
      });

      const webview = container.querySelector<HTMLElement>('webview')!;
      Object.assign(webview, {
        canGoBack: () => false,
        canGoForward: () => false,
        getTitle: () => 'Example',
        getURL: () => 'https://example.com/',
        getWebContentsId: () => 456,
        setZoomFactor: vi.fn(),
      });

      await act(async () => webview.dispatchEvent(new dom.window.Event('did-start-loading')));
      expect(browserRpc.bindWebContents).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
      // 页面还挂着，没有崩
      expect(container.querySelector('webview')).toBe(webview);
    } finally {
      warn.mockRestore();
    }
  });

  it('[XG-CUSTOM] 早绑定：guest 还没 attach（getWebContentsId 抛错）只 warn、不绑、不崩', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = browserSessionStore.createSession({
        browserId: 'browser-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        initialUrl: 'https://hanging.example.com/',
      });

      await act(async () => {
        root.render(
          React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
        );
      });

      const webview = container.querySelector<HTMLElement>('webview')!;
      Object.assign(webview, {
        canGoBack: () => false,
        canGoForward: () => false,
        getTitle: () => '',
        getURL: () => 'https://hanging.example.com/',
        // 真 Electron 在 guest 还没 attach 时就是这么抛的（web-view-element.ts）；
        // 实测「连接挂住」的加载里 did-start-loading / did-attach 都还是抛的。
        getWebContentsId: () => {
          throw new Error(
            'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.'
          );
        },
        setZoomFactor: vi.fn(),
      });

      await act(async () => webview.dispatchEvent(new dom.window.Event('did-start-loading')));
      expect(browserRpc.bindWebContents).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      expect(container.querySelector('webview')).toBe(webview);
    } finally {
      warn.mockRestore();
    }
  });

  // [XG-CUSTOM] 2026-10-06 —— **真实病根**（探针实测后的结论，钉住现状）：
  // 主框架加载失败时，面板会把 `<webview>` 换成错误视图 ⇒ React 卸载 webview ⇒ guest
  // `detachGuest` + webContents 销毁 ⇒ 就算早绑定过，这一页也会从 `/json/list` 里消失。
  // 所以"加载失败也要留在 /json/list"这件事，光靠早绑定**做不到**，需要另外的改动
  // （保留挂载 / 用覆盖层显示错误），见 OPS.md【2026-10-06】TASK 3 的"未覆盖点"。
  it('[XG-CUSTOM] 主框架加载失败会把 <webview> 换成错误视图（= guest 被销毁，白名单随即丢页）', async () => {
    const session = browserSessionStore.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'https://j-designcenter.com/',
    });

    await act(async () => {
      root.render(
        React.createElement(BrowserPane, { browserId: session.browserId, visible: true })
      );
    });

    const webview = container.querySelector<HTMLElement>('webview')!;
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getTitle: () => '',
      getURL: () => 'https://j-designcenter.com/',
      getWebContentsId: () => 789,
      setZoomFactor: vi.fn(),
    });

    await act(async () => webview.dispatchEvent(new dom.window.Event('did-start-loading')));
    expect(container.querySelector('webview')).toBe(webview);

    await act(async () => {
      webview.dispatchEvent(
        Object.assign(new dom.window.Event('did-fail-load'), {
          errorCode: -105,
          errorDescription: 'net::ERR_NAME_NOT_RESOLVED',
          validatedURL: 'https://j-designcenter.com/',
          isMainFrame: true,
        })
      );
    });

    expect(container.querySelector('webview')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe("This site can't be reached");
  });
});
