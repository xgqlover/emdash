// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
//
// [XG-CUSTOM] 2026-10-06 —— 「尽早把内嵌 `<webview>` 绑上 browserId」的幂等绑定器。
//
// 为什么要有它（真机事故 2026-10-06）：agent 经 9223 桥 `POST /xg/open-browser` 开的页，
// Windows 屏幕上真的出现了新标签、地址栏也填上了 URL，而 `/json/list` 始终是 `[]`，
// 桥只能靠白名单判成败 ⇒ 回了「30s 内没有页面被绑定」。白名单
// （`browserWebContentsRegistry.listBoundBrowsers()`）**只收 `bindWebContents` 绑过的页**，
// 旧实现只在 `dom-ready` 里绑一次 ⇒ **页面加载慢（连接挂住 / 代理半死）时，只要 dom-ready
// 还没来就永远不绑**：页明明开在屏幕上，agent 却被告知"没开出来"。
//
// 为什么不能"只在 did-attach / did-start-loading 各绑一次"就完事（实测，见 OPS.md）：
// 在 Electron 40.10.2 上跑真探针，「挂住的加载（TCP 连上但永不回响应）」与「快速失败」
// 两种情况下事件序**不一样**，而且 `getWebContentsId()` 在 `did-attach` / `did-start-loading`
// 时**有时有效、有时抛** "The WebView must be attached to the DOM and the dom-ready event
// emitted before this method can be called."（那次实测就是抛的）——因为它是
// `createGuest()` 的 invoke 回包与事件转发的**竞态**。所以早绑定必须是**带退避重试**的：
// 拿不到 id 就等下一个事件 + 短定时器重试，一旦 `createGuest` 回包落地（毫秒级）就绑上，
// 完全不必等 dom-ready。
//
// 边界（一个字都不放开）：这里只多做**一次**渲染进程 → 主进程的 `bindWebContents` 调用，
// 时序提前、不改任何白名单 / partition 校验（见 browser-webcontents-registry.bindWebContents）；
// 主进程仍然只认 `did-attach-webview` 进过 pending 集合的 webContents。
//
// 语义（四条，都钉在这里以免调用方各自猜）：
//   1. **幂等**：已绑定 / 正在绑定时再调 `bind()` 是空操作 —— 重复事件不会重复注册、
//      重复调 `bindWebContents` 返回 `true`（已绑过）也不算失败；
//   2. **绝不抛**：`getWebContentsId()` 的抛错、RPC 的 reject 一律只 `console.warn` ——
//      这是"尽力而为"的自动路径，不能把渲染进程搞崩；
//   3. **失败可重试**：拿不到 id / 主进程回 `{success:false}`（没进 pending、partition 对不上）
//      时都不置 `bound`，并在 `RETRY_WINDOW_MS` 内按 `RETRY_DELAY_MS` 重试；
//      之后任何一个 webview 事件再调 `bind()` 都会**重新开一轮窗口**；
//   4. **dispose 停手**：webview 卸载（React effect cleanup）后立刻清定时器，不再碰它。
import type { BrowserWebviewElement } from './browser-webview-types';

/** `bindWebContents` 的结果：只认显式 `success:false` 为失败，其余（含 `undefined`）按成功处理 */
export type WebviewBindResult = { success?: boolean } | undefined;

/** 退避重试间隔（毫秒）：只做本地 `getWebContentsId()` + 一次 RPC，代价极小 */
export const XG_WEBVIEW_BIND_RETRY_DELAY_MS = 250;
/**
 * 一轮退避重试的时间窗（毫秒）：覆盖 `createGuest()` 回包晚于事件转发的竞态。
 * 实测该回包是毫秒级（同机 IPC），10s 只是"机器极卡 / Windows 侧跨机"的余量；
 * 窗口内没绑上就停手（下一个 webview 事件会重新开一轮），不会长期空转。
 */
export const XG_WEBVIEW_BIND_RETRY_WINDOW_MS = 10_000;

export type WebviewWebContentsBinder = {
  /** 尽力绑定一次；已绑定 / 正在绑定 / 不是当前元素时是空操作。**绝不抛。** */
  bind(): void;
  /** 主进程是否已确认绑定成功（早绑定的"不再重试"判据） */
  isBound(): boolean;
  /** webview 卸载时调用：清掉待重试的定时器 */
  dispose(): void;
};

export function createWebviewWebContentsBinder(options: {
  webview: BrowserWebviewElement;
  /** 真正落到主进程的那一步（渲染进程侧 = `client.bindWebContents`） */
  bind: (webContentsId: number) => Promise<WebviewBindResult>;
  /** 这个 webview 还是不是当前挂着的那个（React ref 守卫，避免给已卸载的元素绑定） */
  isCurrent?: () => boolean;
  retryDelayMs?: number;
  retryWindowMs?: number;
}): WebviewWebContentsBinder {
  const retryDelayMs = options.retryDelayMs ?? XG_WEBVIEW_BIND_RETRY_DELAY_MS;
  const retryWindowMs = options.retryWindowMs ?? XG_WEBVIEW_BIND_RETRY_WINDOW_MS;

  let bound = false;
  let inFlight = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleRetry = () => {
    if (disposed || bound || inFlight || timer !== null) return;
    if (Date.now() >= deadline) return;
    timer = setTimeout(() => {
      timer = null;
      attempt();
    }, retryDelayMs);
  };

  const attempt = () => {
    if (disposed || bound || inFlight) return;
    if (options.isCurrent !== undefined && !options.isCurrent()) return;

    let webContentsId: number;
    try {
      webContentsId = options.webview.getWebContentsId();
    } catch (error) {
      // guest 还没 attach（Electron 会抛 "The WebView must be attached to the DOM…"）：
      // 这是 createGuest() 回包与事件转发的竞态，退避重试即可，不是错误路径。
      console.warn(
        '[XG-CUSTOM] 内嵌浏览器早绑定：webContentsId 还不可用（退避重试中）',
        error instanceof Error ? error.message : error
      );
      scheduleRetry();
      return;
    }
    if (!Number.isFinite(webContentsId)) {
      console.warn(
        '[XG-CUSTOM] 内嵌浏览器早绑定：拿到的 webContentsId 不是有效数字',
        webContentsId
      );
      scheduleRetry();
      return;
    }

    inFlight = true;
    void Promise.resolve()
      .then(() => options.bind(webContentsId))
      .then((result) => {
        if (result?.success === false) {
          console.warn(
            '[XG-CUSTOM] 内嵌浏览器早绑定被主进程拒绝（可能还没 attach / partition 对不上），退避重试中',
            { webContentsId }
          );
          return;
        }
        bound = true;
      })
      .catch((error: unknown) => {
        console.warn('[XG-CUSTOM] 内嵌浏览器早绑定失败（不影响页面，退避重试中）', error);
      })
      .finally(() => {
        inFlight = false;
        if (!bound) scheduleRetry();
      });
  };

  return {
    bind: () => {
      if (disposed || bound || inFlight || timer !== null) return;
      // 每个外部事件都重新开一轮窗口：did-attach 抛了，did-start-loading / dom-ready 还有机会
      deadline = Date.now() + retryWindowMs;
      attempt();
    },
    isBound: () => bound,
    dispose: () => {
      disposed = true;
      clearTimer();
    },
  };
}
