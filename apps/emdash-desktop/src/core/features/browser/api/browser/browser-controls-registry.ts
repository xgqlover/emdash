import type { BrowserWebviewAdapter } from '../../browser/browser-webview-types';

export type BrowserControls = {
  adapter: BrowserWebviewAdapter | null;
  focusUrl(): void;
  // [XG-CUSTOM] 2026-10-06 —— 复用开页：把「地址栏输入 URL 的那条导航路」（BrowserPane 的
  // navigateTo → loadUrl：有 adapter 走 adapter.loadUrl，没有就换 webview src/revision）
  // 暴露给 pane 之外的复用判定（core/features/browser/api/browser/open-browser-tab.ts）。
  // 返回 false = 现在导航不了（调用方退回落地的"新开"行为，不静默丢页）。
  navigate(url: string): boolean;
};

class BrowserControlsRegistry {
  private readonly controls = new Map<string, BrowserControls>();

  register(browserId: string, controls: BrowserControls): () => void {
    this.controls.set(browserId, controls);
    return () => {
      if (this.controls.get(browserId) === controls) {
        this.controls.delete(browserId);
      }
    };
  }

  get(browserId: string): BrowserControls | undefined {
    return this.controls.get(browserId);
  }

  clear(): void {
    this.controls.clear();
  }
}

export const browserControlsRegistry = new BrowserControlsRegistry();
