// [XG-CUSTOM] 2026-10-06 —— 内嵌浏览器「早绑定」绑定器的单测（离线可复现）。
//
// 钉住四条不变量（都是被真机事故/真 Electron 探针逼出来的）：
//   1. 幂等：重复 bind() / 重复 webview 事件只调一次 bindWebContents；
//      「已绑过 → 主进程回 {success:true}」不算失败；
//   2. 绝不抛：getWebContentsId() 抛错（guest 还没 attach 的竞态）、RPC reject 都只 warn；
//   3. 退避重试：拿不到 id / 被拒 / reject 之后，短定时器会重试 —— 因此**慢页面 / 失败页
//      也能进白名单**，不必等 dom-ready；
//   4. dispose 停手：webview 卸载后不再碰它、不留定时器。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebviewWebContentsBinder,
  XG_WEBVIEW_BIND_RETRY_DELAY_MS,
  XG_WEBVIEW_BIND_RETRY_WINDOW_MS,
} from './browser-webview-bind';
import type { BrowserWebviewElement } from './browser-webview-types';

type FakeWebviewOptions = {
  webContentsId?: number | (() => number);
};

function fakeWebview(options: FakeWebviewOptions = {}): BrowserWebviewElement {
  const resolveId = (): number => {
    const value = options.webContentsId ?? 42;
    return typeof value === 'function' ? value() : value;
  };
  return { getWebContentsId: () => resolveId() } as unknown as BrowserWebviewElement;
}

describe('createWebviewWebContentsBinder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('binds once with the webview webContents id and stays bound', async () => {
    const bind = vi.fn(async () => ({ success: true }));
    const binder = createWebviewWebContentsBinder({ webview: fakeWebview(), bind });

    binder.bind();
    await vi.waitFor(() => expect(binder.isBound()).toBe(true));

    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(42);

    // 重复事件 → 空操作（不重复注册、不重复 RPC）
    binder.bind();
    binder.bind();
    await Promise.resolve();
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it('treats "already bound" (repeated bindWebContents → success) as success, not failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 主进程对"已绑过"的重复调用就是回 success:true（registry.bindWebContents 的幂等分支）
    const bind = vi.fn(async () => ({ success: true }));
    const binder = createWebviewWebContentsBinder({ webview: fakeWebview(), bind });

    binder.bind();
    await vi.waitFor(() => expect(binder.isBound()).toBe(true));

    expect(warn).not.toHaveBeenCalled();
  });

  it('retries with a short timer when the guest is not attached yet (getWebContentsId throws)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let attached = false;
    const webview = fakeWebview({
      webContentsId: () => {
        if (!attached) {
          // 真 Electron 原话（web-view-element.ts::getWebContentsId）
          throw new Error(
            'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.'
          );
        }
        return 77;
      },
    });
    const bind = vi.fn(async () => ({ success: true }));
    const binder = createWebviewWebContentsBinder({ webview, bind });

    expect(() => binder.bind()).not.toThrow();
    expect(bind).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();

    // createGuest() 的回包落地（真机上就是毫秒级）→ 下一次退避重试就绑上，**不必等 dom-ready**
    attached = true;
    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_DELAY_MS);

    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(77);
    expect(binder.isBound()).toBe(true);

    // 绑上之后不再空转
    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_WINDOW_MS);
    expect(bind).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps retrying while the main process rejects the bind (success: false)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bind = vi
      .fn(async () => ({ success: false }))
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValue({ success: true });
    const binder = createWebviewWebContentsBinder({ webview: fakeWebview(), bind });

    binder.bind();
    await vi.advanceTimersByTimeAsync(0);
    expect(binder.isBound()).toBe(false);

    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_DELAY_MS * 3);
    expect(binder.isBound()).toBe(true);
    expect(bind).toHaveBeenCalledTimes(3);
  });

  it('never throws when the bind call itself rejects (only warns)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bind = vi.fn(async () => {
      throw new Error('bridge down');
    });
    const binder = createWebviewWebContentsBinder({ webview: fakeWebview(), bind });

    expect(() => binder.bind()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_DELAY_MS);
    expect(warn).toHaveBeenCalled();
    expect(binder.isBound()).toBe(false);
  });

  it('stops retrying after the retry window and does not spin forever', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bind = vi.fn(async () => ({ success: false }));
    const binder = createWebviewWebContentsBinder({ webview: fakeWebview(), bind });

    binder.bind();
    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_WINDOW_MS * 2);

    expect(vi.getTimerCount()).toBe(0);
    expect(bind.mock.calls.length).toBeLessThanOrEqual(
      XG_WEBVIEW_BIND_RETRY_WINDOW_MS / XG_WEBVIEW_BIND_RETRY_DELAY_MS + 2
    );
  });

  it('does not bind a webview that is no longer the mounted element', async () => {
    const bind = vi.fn(async () => ({ success: true }));
    const binder = createWebviewWebContentsBinder({
      webview: fakeWebview(),
      bind,
      isCurrent: () => false,
    });

    binder.bind();
    await Promise.resolve();
    expect(bind).not.toHaveBeenCalled();
  });

  it('dispose() stops pending retries and further binds', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let attached = false;
    const webview = fakeWebview({
      webContentsId: () => {
        if (!attached) throw new Error('not attached');
        return 5;
      },
    });
    const bind = vi.fn(async () => ({ success: true }));
    const binder = createWebviewWebContentsBinder({ webview, bind });

    binder.bind();
    expect(vi.getTimerCount()).toBe(1);

    binder.dispose();
    expect(vi.getTimerCount()).toBe(0);

    attached = true;
    binder.bind();
    await vi.advanceTimersByTimeAsync(XG_WEBVIEW_BIND_RETRY_WINDOW_MS);
    expect(bind).not.toHaveBeenCalled();
  });
});
