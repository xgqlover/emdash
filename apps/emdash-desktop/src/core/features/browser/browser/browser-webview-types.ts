export type BrowserWebviewEventMap = {
  'dom-ready': Event;
  // [XG-CUSTOM] 2026-10-06 —— 早绑定用的两个钩子（都早于 `dom-ready`）：
  //   · `did-attach`  = Electron 文档「Fired when attached to the embedder web contents」
  //   · `did-finish-load` = 加载完成/失败（error page 也会发）时收尾再试一次
  // 实测事件序（Electron 40.10.2 / Linux + Xvfb，见 OPS.md【2026-10-06】TASK 3）：
  //   did-start-loading → did-attach → (did-fail-load) → dom-ready → did-finish-load → did-stop-loading
  'did-attach': Event;
  'did-finish-load': Event;
  'did-start-loading': Event;
  'did-stop-loading': Event;
  'did-navigate': { url: string };
  'did-navigate-in-page': { url: string };
  'did-fail-load': {
    errorCode: number;
    errorDescription: string;
    validatedURL: string;
    isMainFrame: boolean;
  };
  'console-message': { level: number; message: string; line: number; sourceId: string };
  'page-title-updated': { title: string };
  'page-favicon-updated': { favicons: string[] };
};

export type BrowserWebviewElement = HTMLElement & {
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  loadURL(url: string): Promise<void> | void;
  setZoomFactor(factor: number): void;
  addEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void;
  removeEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void;
};

export type BrowserWebviewAdapter = {
  canGoBack(): boolean;
  canGoForward(): boolean;
  currentUrl(): string;
  title(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  loadUrl(url: string): Promise<void>;
  setZoomFactor(factor: number): void;
  focus(): void;
};

export function createBrowserWebviewAdapter(webview: BrowserWebviewElement): BrowserWebviewAdapter {
  return {
    canGoBack: () => webview.canGoBack(),
    canGoForward: () => webview.canGoForward(),
    currentUrl: () => webview.getURL(),
    title: () => webview.getTitle(),
    goBack: () => webview.goBack(),
    goForward: () => webview.goForward(),
    reload: () => webview.reload(),
    reloadIgnoringCache: () => webview.reloadIgnoringCache(),
    stop: () => webview.stop(),
    loadUrl: async (url: string) => {
      await webview.loadURL(url);
    },
    setZoomFactor: (factor: number) => webview.setZoomFactor(factor),
    focus: () => webview.focus(),
  };
}
