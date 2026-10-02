// [XG-CUSTOM] 「从零开内嵌浏览器页」渲染进程侧单测。
//
// 这条链路的关键判断是「开在哪个 task view 里」——开错了（或没导航过去）页面就不会上屏，
// `<webview>` 不 attach → 不被 `bindWebContents` 绑定 → agent 拿不到可操作的目标。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEmbeddedBrowserTab } from './embedded-browser-open-request';

const mocks = vi.hoisted(() => ({
  getTaskComposition: vi.fn(),
  navigate: vi.fn(),
  navigationRef: {
    viewId: 'home',
    params: {} as { projectId?: string; taskId?: string },
    key: 'home',
  },
  visibleTaskEntries: [] as Array<{ projectId: string; taskId: string }>,
  paneOpen: vi.fn(),
  setFocusedRegion: vi.fn(),
}));

vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskComposition: mocks.getTaskComposition,
}));

vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => ({
    currentRef: mocks.navigationRef,
    navigate: mocks.navigate,
  }),
}));

vi.mock('@core/features/workbench/contributions/browser/app-stores', () => ({
  getSidebarStore: () => ({ visibleTaskEntries: mocks.visibleTaskEntries }),
}));

vi.mock('@core/features/tasks/contributions/views', () => ({
  taskViewDef: (params: { projectId: string; taskId: string }) => ({ viewId: 'task', params }),
}));

vi.mock('@core/features/browser/api/browser/client', () => ({
  getBrowserClient: vi.fn(async () => ({ events: { subscribe: vi.fn() } })),
}));

function taskView() {
  return { paneLayout: { open: mocks.paneOpen }, setFocusedRegion: mocks.setFocusedRegion };
}

describe('[XG-CUSTOM] openEmbeddedBrowserTab（从零开内嵌浏览器页）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigationRef.viewId = 'home';
    mocks.navigationRef.params = {};
    mocks.visibleTaskEntries = [{ projectId: 'p1', taskId: 't1' }];
    mocks.getTaskComposition.mockReturnValue(taskView());
  });

  it('已经停在某个 task → 就地开标签页，不导航（不动用户视野）', () => {
    mocks.navigationRef.viewId = 'task';
    mocks.navigationRef.params = { projectId: 'p9', taskId: 't9' };
    const ok = openEmbeddedBrowserTab('https://example.com');
    expect(ok).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getTaskComposition).toHaveBeenCalledWith('p9', 't9');
    expect(mocks.paneOpen).toHaveBeenCalledWith('browser', { initialUrl: 'https://example.com' });
    expect(mocks.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('停在非 task 的视图（项我/设置…）→ 退到侧边栏第一个 task 并导航过去', () => {
    const ok = openEmbeddedBrowserTab('https://example.com');
    expect(ok).toBe(true);
    expect(mocks.navigate).toHaveBeenCalledWith({
      viewId: 'task',
      params: { projectId: 'p1', taskId: 't1' },
    });
    expect(mocks.paneOpen).toHaveBeenCalledWith('browser', { initialUrl: 'https://example.com' });
  });

  // [XG-CUSTOM] bot ⟷ profile：主进程按 bot 解析好的 profileId 必须原样传下去
  // （paneLayout.open 的 args 是唯一入口；丢了它 = 用别人的登录态开页）。
  it('带 profileId → 透传给 paneLayout.open（agent 按 bot 选身份）', () => {
    mocks.navigationRef.viewId = 'task';
    mocks.navigationRef.params = { projectId: 'p9', taskId: 't9' };
    const ok = openEmbeddedBrowserTab('https://example.com', 'bot-sxsj');
    expect(ok).toBe(true);
    expect(mocks.paneOpen).toHaveBeenCalledWith('browser', {
      initialUrl: 'https://example.com',
      profileId: 'bot-sxsj',
    });
  });

  it('不带 profileId（老调用方）→ args 里没有这个键，与改动前逐字节一致', () => {
    mocks.navigationRef.viewId = 'task';
    mocks.navigationRef.params = { projectId: 'p9', taskId: 't9' };
    openEmbeddedBrowserTab('https://example.com');
    expect(mocks.paneOpen).toHaveBeenCalledWith('browser', { initialUrl: 'https://example.com' });
  });

  it('profileId 是空白串 → 当作没带（不给"空 profile"留后门）', () => {
    mocks.navigationRef.viewId = 'task';
    mocks.navigationRef.params = { projectId: 'p9', taskId: 't9' };
    openEmbeddedBrowserTab('https://example.com', '   ');
    expect(mocks.paneOpen).toHaveBeenCalledWith('browser', { initialUrl: 'https://example.com' });
  });

  it('一个 task 都没有 → 如实返回 false，不假装开了', () => {
    mocks.visibleTaskEntries = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = openEmbeddedBrowserTab('https://example.com');
    warn.mockRestore();
    expect(ok).toBe(false);
    expect(mocks.paneOpen).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('task 还没 provision 完（拿不到 view）→ false，不抛', () => {
    mocks.getTaskComposition.mockReturnValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = openEmbeddedBrowserTab('https://example.com');
    warn.mockRestore();
    expect(ok).toBe(false);
    expect(mocks.paneOpen).not.toHaveBeenCalled();
  });
});
