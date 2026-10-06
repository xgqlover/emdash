// [XG-CUSTOM] 2026-10-06 —— 「复用已有 browser 标签开页」的回归单测（根因：
// 同一个 URL 被球/agent 每说一次「打开 X」就叠一个新标签，因为 browser provider 是 mount:'multi'）。
//
// 钉住两件事：
//   ① 判定：已有标签 profile 一致 → 复用；profile 不同（别的 bot）→ 新开；没有标签 → 新开。
//   ② 复用那条路**确实调了导航**，而且**没有** `paneLayout.open` —— 那才是唯一会走到
//      `browserTabProvider.onBeforeOpen` → `browserSessionStore.createSession()`（= 新标签）的一步。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserControlsRegistry } from '@core/features/browser/api/browser/browser-controls-registry';
import { restoreAppSettingsCache } from '@core/features/settings/api/browser/app-settings-client';
import {
  openBrowserTabOrReuse,
  pickReusableBrowserTab,
  type BrowserTabOpenTarget,
  type ExistingBrowserTab,
} from './open-browser-tab';

const BOT_PROFILE = 'bot-sangcha';
const DEFAULT_PROFILE = 'default';
const URL_A = 'https://www.jagda.or.jp/';
const URL_B = 'https://g-mark.org/';

const TAB: ExistingBrowserTab = { tabId: 'tab-1', browserId: 'b-1', profileId: BOT_PROFILE };

/** 一个 task 里的 browser 标签 entry（形状与 BrowserState / 快照恢复后一致）。 */
function browserEntry(tabId: string, browserId: string, profileId: string) {
  return { tabId, state: { browserId, session: { browserId, profileId } } };
}

function fakeTarget(entry?: { tabId: string; state: unknown }) {
  const open = vi.fn();
  const activateTabOfKind = vi.fn();
  const target: BrowserTabOpenTarget = {
    paneLayout: { open },
    lastTabEntryOfKind: vi.fn(() => entry),
    activateTabOfKind,
  };
  return { target, open, activateTabOfKind };
}

function registerNavigate(browserId: string, result = true) {
  const navigate = vi.fn(() => result);
  browserControlsRegistry.register(browserId, { adapter: null, focusUrl: () => {}, navigate });
  return navigate;
}

afterEach(() => {
  browserControlsRegistry.clear();
  restoreAppSettingsCache('browser', undefined, undefined);
});

describe('pickReusableBrowserTab', () => {
  it('① profile 完全一致 → 复用这个标签', () => {
    expect(pickReusableBrowserTab(TAB, BOT_PROFILE)).toEqual(TAB);
  });

  it('② profile 不同（别的 bot / 显式指定了别的 profile）→ 不复用（宁可多一个标签）', () => {
    expect(pickReusableBrowserTab(TAB, DEFAULT_PROFILE)).toBeUndefined();
  });

  it('③ 没有已存在的标签 → 不复用', () => {
    expect(pickReusableBrowserTab(undefined, BOT_PROFILE)).toBeUndefined();
  });

  it('没解析出 profile（undefined / 空白）→ 不复用（不猜）', () => {
    expect(pickReusableBrowserTab(TAB, undefined)).toBeUndefined();
    expect(pickReusableBrowserTab(TAB, '   ')).toBeUndefined();
  });
});

describe('openBrowserTabOrReuse', () => {
  it('★ 复用：调了导航 + 精确激活那一个标签，且**没有** paneLayout.open（→ 不会 createSession）', () => {
    const { target, open, activateTabOfKind } = fakeTarget(
      browserEntry('tab-1', 'b-1', BOT_PROFILE)
    );
    const navigate = registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'reused'
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(URL_A);
    expect(activateTabOfKind).toHaveBeenCalledTimes(1);
    expect(activateTabOfKind).toHaveBeenCalledWith('browser', 'tab-1');
    // ← 这一条就是"没有 createSession"：新标签唯一的路是 paneLayout.open → onBeforeOpen → createSession
    expect(open).not.toHaveBeenCalled();
  });

  it('复用后导航到**新** URL（不是复用旧 URL）', () => {
    const { target } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    const navigate = registerNavigate('b-1');

    openBrowserTabOrReuse(target, { initialUrl: URL_B, reuseProfileId: BOT_PROFILE });

    expect(navigate).toHaveBeenCalledWith(URL_B);
  });

  it('★ profile 不同 → 新开（与改动前逐字节一致：只带 initialUrl）', () => {
    const { target, open, activateTabOfKind } = fakeTarget(
      browserEntry('tab-1', 'b-1', DEFAULT_PROFILE)
    );
    const navigate = registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'opened'
    );

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
    expect(navigate).not.toHaveBeenCalled();
    expect(activateTabOfKind).not.toHaveBeenCalled();
  });

  it('★ 没有任何已有标签 → 新开（零回归）', () => {
    const { target, open } = fakeTarget(undefined);

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'opened'
    );

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
  });

  it('reuseExisting:false（task.openBrowser「新开浏览器」）→ 即使 profile 一致也新开', () => {
    const { target, open } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    const navigate = registerNavigate('b-1');

    expect(
      openBrowserTabOrReuse(target, {
        initialUrl: URL_A,
        reuseProfileId: BOT_PROFILE,
        reuseExisting: false,
      })
    ).toBe('opened');

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('没有 url（task.openBrowser 开空白页）→ 新开，且 args 与改动前逐字节一致（{}）', () => {
    const { target, open } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));

    expect(openBrowserTabOrReuse(target, { reuseExisting: false })).toBe('opened');
    expect(open).toHaveBeenCalledWith('browser', {});
  });

  it('已有页但这一页暂时导航不了（没注册 controls）→ 退回新开，不让「打开 X」变成没反应', () => {
    const { target, open } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'opened'
    );

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
  });

  it('导航明确失败（navigate 返回 false）→ 退回新开', () => {
    const { target, open } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    registerNavigate('b-1', false);

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'opened'
    );

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
  });

  it('没有 task view → unavailable（什么都不做）', () => {
    expect(openBrowserTabOrReuse(undefined, { initialUrl: URL_A })).toBe('unavailable');
  });

  it('entry.state 认不出来（没有 browserId）→ 新开（不猜）', () => {
    const { target, open } = fakeTarget({ tabId: 'tab-x', state: {} });

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, reuseProfileId: BOT_PROFILE })).toBe(
      'opened'
    );

    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
  });

  it('带 profileId（主进程解析好的）→ 原样透传给新开那条路', () => {
    const { target, open } = fakeTarget(undefined);

    openBrowserTabOrReuse(target, {
      initialUrl: URL_A,
      profileId: BOT_PROFILE,
      botId: 'sangcha',
    });

    expect(open).toHaveBeenCalledWith('browser', {
      initialUrl: URL_A,
      profileId: BOT_PROFILE,
      botId: 'sangcha',
    });
  });
});

describe('openBrowserTabOrReuse — profile 解析（与 onBeforeOpen 的 resolveOpenProfile 同源）', () => {
  /** 设置快照：default + 一个绑给 sangcha 的 bot profile。 */
  function seedBrowserSettings(defaultProfileId = DEFAULT_PROFILE) {
    const value = {
      defaultProfileId,
      relaxCorsForLocalhost: false,
      profiles: [
        { id: DEFAULT_PROFILE, name: 'Default' },
        { id: BOT_PROFILE, name: 'sangcha', botId: 'sangcha' },
      ],
    };
    restoreAppSettingsCache('browser', { value, defaults: value, overrides: {} }, undefined);
  }

  it('不带 profileId 的入口（预览 pill / 外部链接）→ 按设置里的 defaultProfileId 复用', () => {
    seedBrowserSettings();
    const { target } = fakeTarget(browserEntry('tab-1', 'b-1', DEFAULT_PROFILE));
    const navigate = registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A })).toBe('reused');
    expect(navigate).toHaveBeenCalledWith(URL_A);
  });

  it('不带 profileId 的入口遇到**别的 bot** 的页 → 不复用（不串登录态）', () => {
    seedBrowserSettings();
    const { target, open } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    const navigate = registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A })).toBe('opened');
    expect(open).toHaveBeenCalledWith('browser', { initialUrl: URL_A });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('带 botId（设置里绑了这个 bot）→ 解析成该 profile 后复用', () => {
    seedBrowserSettings();
    const { target } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, botId: 'sangcha' })).toBe('reused');
  });

  it('带 botId 但设置里还没绑 → 解析成确定性 `bot-<botId>`（与 onBeforeOpen 一致）', () => {
    seedBrowserSettings();
    const { target } = fakeTarget(browserEntry('tab-1', 'b-1', 'bot-sxsj'));
    registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, botId: 'sxsj' })).toBe('reused');
  });

  it('设置快照还没来（冷启动）→ 只认请求里显式给的 profile，仍能复用', () => {
    const { target } = fakeTarget(browserEntry('tab-1', 'b-1', BOT_PROFILE));
    registerNavigate('b-1');

    expect(openBrowserTabOrReuse(target, { initialUrl: URL_A, profileId: BOT_PROFILE })).toBe(
      'reused'
    );
  });

  it('真机那 4 个老页（profile=default）+ 带 botId 的请求 → **不复用**（身份不同，宁可新开）', () => {
    // 复现用户那台机器：`/json/list` 里 4 个 jagda.or.jp 的 profile 都是 `default`，请求带 botId=shangcha。
    // 此时本次请求会解析成 `bot-shangcha`（设置里没绑 shangcha）→ 与老页的 `default` 不一致 →
    // **不拿别人的页凑数**（串登录态），新开一个 bot-shangcha 的页；之后同一身份就稳定复用它。
    seedBrowserSettings();
    const { target, open } = fakeTarget(browserEntry('tab-legacy', 'b-legacy', DEFAULT_PROFILE));
    const navigate = registerNavigate('b-legacy');

    expect(
      openBrowserTabOrReuse(target, {
        initialUrl: URL_A,
        profileId: DEFAULT_PROFILE,
        botId: 'shangcha',
      })
    ).toBe('opened');

    expect(open).toHaveBeenCalledWith('browser', {
      initialUrl: URL_A,
      profileId: DEFAULT_PROFILE,
      botId: 'shangcha',
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
