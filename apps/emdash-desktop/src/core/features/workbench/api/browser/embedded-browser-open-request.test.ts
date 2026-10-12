// [XG-CUSTOM 2026-10-05] `pickTargetTask` 回归：**用户要看 → 开在用户眼前；agent 自用 → 维持隔离**。
import { describe, expect, it, vi } from 'vitest';
import { openEmbeddedBrowserTab, pickTargetTask } from './embedded-browser-open-request';

const USER = { projectId: 'p-user', taskId: 't-user' };
const BOT = { projectId: 'bot-sxsj', taskId: 't-bot' };
const FIRST = { projectId: 'p-first', taskId: 't-first' };

// [XG-CUSTOM 2026-10-12] `openEmbeddedBrowserTab` 的**返回值**回归：`boolean` → `{ok, reason}`。
// 为什么要有这组：球里点链接要靠这个 reason 说人话（原来只回 false ⇒ 完全静默）。
// 这里把它的四类依赖（导航 / 侧边栏 store / task view 组合器 / 开页复用）都换成假的，
// 于是三条失败原因码与成功路径都能**离线钉死**。
const state = vi.hoisted(() => ({
  currentRef: undefined as undefined | { viewId: string; params: Record<string, unknown> },
  visibleTaskEntries: [] as Array<{ projectId: string; taskId: string }>,
  /** undefined = 拿不到 task view（还没 provision 完） */
  hasTaskView: false,
  reuseOutcome: 'opened' as 'opened' | 'reused' | 'unavailable',
  navigations: [] as unknown[],
  activateLastTabOfKind: vi.fn(),
  setFocusedRegion: vi.fn(),
}));

vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => ({
    // 真实导航永远有一个 currentRef（不是 task 视图时是别的视图）⇒ 兜底给个非 task 的
    currentRef: state.currentRef ?? { viewId: 'home', params: {} },
    navigate: (def: unknown) => {
      state.navigations.push(def);
    },
  }),
}));
vi.mock('@core/features/workbench/contributions/browser/app-stores', () => ({
  getSidebarStore: () => ({ visibleTaskEntries: state.visibleTaskEntries }),
}));
vi.mock('@core/features/tasks/contributions/views', () => ({
  taskViewDef: (ref: unknown) => ({ viewId: 'task', params: ref }),
}));
vi.mock('./task-composition-selectors', () => ({
  getTaskComposition: () =>
    state.hasTaskView
      ? {
          activateLastTabOfKind: state.activateLastTabOfKind,
          setFocusedRegion: state.setFocusedRegion,
        }
      : undefined,
}));
vi.mock('@core/features/browser/api/browser/open-browser-tab', () => ({
  openBrowserTabOrReuse: () => state.reuseOutcome,
}));
vi.mock('@core/features/browser/api/browser/client', () => ({ getBrowserClient: vi.fn() }));
vi.mock('@core/primitives/logging/browser/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

/** 每个用例都从"一个有 task、能拿到 view、开页成功"的干净世界开始 */
function reset(input: {
  currentRef?: { viewId: string; params: Record<string, unknown> };
  visibleTaskEntries?: Array<{ projectId: string; taskId: string }>;
  hasTaskView?: boolean;
  reuseOutcome?: 'opened' | 'reused' | 'unavailable';
}): void {
  state.currentRef = input.currentRef;
  state.visibleTaskEntries = input.visibleTaskEntries ?? [];
  state.hasTaskView = input.hasTaskView ?? true;
  state.reuseOutcome = input.reuseOutcome ?? 'opened';
  state.navigations = [];
  state.activateLastTabOfKind.mockClear();
  state.setFocusedRegion.mockClear();
}

const IN_TASK_VIEW = { viewId: 'task', params: { projectId: 'p-user', taskId: 't-user' } };

describe('[XG-CUSTOM 2026-10-12] openEmbeddedBrowserTab 的结果（{ok, reason}）', () => {
  it('★ 一个 task 都没有 → {ok:false, reason:"no-task"}（球据此说"没有任务可挂"）', () => {
    // 当前视野在 task 视图里也没用：可见 task 列表空 = 那个 task 也不在了
    reset({ currentRef: { viewId: 'settings', params: {} } });
    expect(openEmbeddedBrowserTab('https://a.example/w')).toEqual({
      ok: false,
      reason: 'no-task',
    });
  });

  it('★ 有 task 但拿不到它的 view → {ok:false, reason:"no-task-view"}', () => {
    reset({
      currentRef: IN_TASK_VIEW,
      visibleTaskEntries: [USER],
      hasTaskView: false,
      reuseOutcome: 'unavailable',
    });
    expect(openEmbeddedBrowserTab('https://a.example/w')).toEqual({
      ok: false,
      reason: 'no-task-view',
    });
    // 拿不到 view 就不该谈开页
    expect(state.setFocusedRegion).not.toHaveBeenCalled();
  });

  it('★ view 在但开页/导航这条路没成 → {ok:false, reason:"unavailable"}', () => {
    reset({
      currentRef: IN_TASK_VIEW,
      visibleTaskEntries: [USER],
      reuseOutcome: 'unavailable',
    });
    expect(openEmbeddedBrowserTab('https://a.example/w')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('成功路径不受影响：opened → {ok:true} + 激活 browser 标签 + 聚焦主区', () => {
    reset({ currentRef: IN_TASK_VIEW, visibleTaskEntries: [USER], reuseOutcome: 'opened' });
    expect(openEmbeddedBrowserTab('https://a.example/w', undefined, undefined, true)).toEqual({
      ok: true,
    });
    expect(state.activateLastTabOfKind).toHaveBeenCalledWith('browser');
    expect(state.setFocusedRegion).toHaveBeenCalledWith('main');
    expect(state.navigations).toEqual([]);
  });

  it('成功路径不受影响：reused（复用了已有页）→ {ok:true}，不再调 activateLastTabOfKind', () => {
    reset({ currentRef: IN_TASK_VIEW, visibleTaskEntries: [USER], reuseOutcome: 'reused' });
    expect(openEmbeddedBrowserTab('https://a.example/w')).toEqual({ ok: true });
    expect(state.activateLastTabOfKind).not.toHaveBeenCalled();
    expect(state.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('用户要看但当前不在 task 视图 → 退到第一个可见 task 并**导航过去**（老行为不变）', () => {
    reset({ visibleTaskEntries: [FIRST], reuseOutcome: 'opened' });
    expect(openEmbeddedBrowserTab('https://a.example/w', undefined, undefined, true)).toEqual({
      ok: true,
    });
    expect(state.navigations).toEqual([{ viewId: 'task', params: FIRST }]);
  });
});

describe('pickTargetTask', () => {
  it('★ presentToUser=true → 开在**用户当前 task**（哪怕 bot 有自己的 task）', () => {
    const got = pickTargetTask({ presentToUser: true, current: USER, botEntry: BOT, first: FIRST });
    expect(got).toEqual({ ref: USER, needsNavigation: false });
  });

  it('★ presentToUser=true 且当前没 task → 退到第一个，且**必须导航**', () => {
    const got = pickTargetTask({ presentToUser: true, botEntry: BOT, first: FIRST });
    expect(got).toEqual({ ref: FIRST, needsNavigation: true });
  });

  it('★ presentToUser=true 且一个 task 都没有 → undefined（调用方如实回失败）', () => {
    expect(pickTargetTask({ presentToUser: true })).toBeUndefined();
  });

  it('agent 自用（false）→ **维持原行为**：bot 自己的 task 优先，且不在那儿就导航', () => {
    const got = pickTargetTask({
      presentToUser: false,
      current: USER,
      botEntry: BOT,
      first: FIRST,
    });
    expect(got).toEqual({ ref: BOT, needsNavigation: true });
  });

  it('agent 自用但已经在 bot 的 task 里 → 不需要导航（零回归）', () => {
    const got = pickTargetTask({ presentToUser: false, current: BOT, botEntry: BOT });
    expect(got).toEqual({ ref: BOT, needsNavigation: false });
  });

  it('agent 自用、没有 botEntry → 当前 task（零回归）', () => {
    const got = pickTargetTask({ presentToUser: false, current: USER, first: FIRST });
    expect(got).toEqual({ ref: USER, needsNavigation: false });
  });
});
