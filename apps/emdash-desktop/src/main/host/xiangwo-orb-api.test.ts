// [XG-CUSTOM 2026-10-03] 球 API 的「图片卡片点击 → 内嵌浏览器」入口单测（`host.openEmbeddedBrowser`）。
//
// 为什么单独测这一条：球渲染进程（独立窗口，跑的不是 React 主窗口）拿不到
// `openEmbeddedBrowserTab`（那要 task 视图/侧边栏 store），所以球的点击只能走主进程这一跳：
//   xiangwo-images.ts → orbApi('host.openEmbeddedBrowser') → 本模块 →
//   boot 注入的 requestEmbeddedBrowserOpen（「从零开页」广播）→ 主窗口 openEmbeddedBrowserTab。
// 这里断言的就是「这一跳有没有接对、坏输入会不会装作成功」。
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })) },
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  shell: { openExternal: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { configureOrbEmbeddedBrowserOpen, routeOrbApi } = await import('./xiangwo-orb-api');

/** 球壳能力（本用例只走 host.openEmbeddedBrowser，其余给最小实现） */
const deps = {
  applyMode: () => ({ horizontal: 'right' as const, vertical: 'down' as const }),
  moveBall: () => ({ docked: null }),
  clampBall: () => ({ docked: null }),
  unsnapBall: () => ({ docked: null }),
  getWindow: () => null,
};

describe('[XG-CUSTOM] host.openEmbeddedBrowser（球里点图片卡片 → 内嵌浏览器）', () => {
  it('把来源作品页交给「从零开页」广播，并带上 bot 身份', async () => {
    const open = vi.fn(() => true);
    configureOrbEmbeddedBrowserOpen(open);
    const result = await routeOrbApi(deps as never, 'host.openEmbeddedBrowser', {
      url: 'https://www.zcool.com.cn/work/Z1.html',
      bot: 'sxsj',
    });
    expect(open).toHaveBeenCalledWith({ url: 'https://www.zcool.com.cn/work/Z1.html', bot: 'sxsj' });
    expect(result).toEqual({ ok: true });
    configureOrbEmbeddedBrowserOpen(null);
  });

  it('不带 bot → 请求里就不带 bot（与改动前逐字节一致）', async () => {
    const open = vi.fn(() => true);
    configureOrbEmbeddedBrowserOpen(open);
    await routeOrbApi(deps as never, 'host.openEmbeddedBrowser', { url: 'https://a.example/work/1' });
    expect(open).toHaveBeenCalledWith({ url: 'https://a.example/work/1' });
    configureOrbEmbeddedBrowserOpen(null);
  });

  it('空 / 非 http(s) 的 url → 拒掉，不问开页实现', async () => {
    const open = vi.fn(() => true);
    configureOrbEmbeddedBrowserOpen(open);
    expect(await routeOrbApi(deps as never, 'host.openEmbeddedBrowser', {})).toEqual({
      ok: false,
      reason: 'bad-url',
    });
    expect(
      await routeOrbApi(deps as never, 'host.openEmbeddedBrowser', {
        url: 'javascript:alert(1)',
      })
    ).toEqual({ ok: false, reason: 'bad-url' });
    expect(open).not.toHaveBeenCalled();
    configureOrbEmbeddedBrowserOpen(null);
  });

  it('boot 没注入（桥没接上）→ 如实回 unavailable，不假装成功', async () => {
    configureOrbEmbeddedBrowserOpen(null);
    expect(
      await routeOrbApi(deps as never, 'host.openEmbeddedBrowser', { url: 'https://a.example/w' })
    ).toEqual({ ok: false, reason: 'unavailable' });
  });
});
