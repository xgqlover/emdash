// [XG-CUSTOM] 2026-10-06 —— 「在某个 task 里开一个内嵌浏览器页」的**复用判定 + 导航**（唯一落点）。
//
// 病根（用户真机实证）：球/agent 每说一次「打开 X」→ 主进程广播 → 渲染进程
// `paneLayout.open('browser', { initialUrl })` → provider 的 `onBeforeOpen` **每次**
// `createSession()`（`browser-tab-provider.tsx`：`mount` 缺省 = multi）。
// 于是 `https://www.jagda.or.jp/` 被**同一个 URL 叠了 4 个标签**。
//
// 规则（与本文件一一对应，改之前先读这段）：
//   ① 请求要开 URL，且**当前 task 的聚焦面板里**已有一个 browser 标签、它的 profile 与本次
//      **解析结果一致** → **不新开**：用「地址栏输入 URL 的那条路」把它导航过去（`BrowserControls.navigate`
//      → `BrowserPane` 的 `navigateTo`/`loadUrl`）→ 切到前台（`activateTabOfKind`）→ 结束。
//   ② profile 不一致（botId 不同 / 显式指定了别的 profile）→ **仍然新开**：
//      跨 profile 复用 = 串身份/串登录态，**宁可多一个标签**。
//   ③ 没有已存在的标签（或拿不到它的导航把手）→ 与改动前**逐字节一致**：`paneLayout.open('browser', args)`。
//   ④ `reuseExisting: false` 的入口（`task.openBrowser`「新开浏览器」）**永远新开**。
//
// 为什么「怎么导航已有标签」是它：`browser-session-store.ts` 只有 `createSession/updateSession/…`，
// 单独 `updateSession({currentUrl})` **不会**让 `<webview>` 动（`browser-pane.tsx` 的 mount effect
// 只在 browserId/partition 变了才重设 src）；渲染侧**既有的**导航路只有 `BrowserPane` 里的
// `navigateTo` → `loadUrl`（先写 session，再有 adapter 走 `adapter.loadUrl`、没有则换 webview src/revision）。
// `browserControlsRegistry` 本来就是「task  scope 访问已开浏览器」的既有通道（`task-scope.tsx` 用它
// 做 back/forward/reload/focusUrl），所以这里只是把**同一条**导航路多暴露一个 `navigate`，
// 不新加 Wire 过程、不碰 WebContentsView、不碰 9223 白名单。
import { resolveOpenProfile } from '@core/features/browser/browser/ensure-bot-browser-profile';
import { getAppSettingValueSnapshot } from '@core/features/settings/api/browser/app-settings-client';
import { browserControlsRegistry } from './browser-controls-registry';

/** 新开时原样交给 `paneLayout.open('browser', …)` 的参数（与 `BrowserOpenArgs` 同形）。 */
export interface BrowserTabOpenArgs {
  readonly initialUrl?: string;
  readonly profileId?: string;
  readonly botId?: string;
}

/** 已经开着的 browser 标签（判定「算不算同一个」需要的最小信息）。 */
export interface ExistingBrowserTab {
  readonly tabId: string;
  readonly browserId: string;
  /** 这一页自己的 profile（真源 = 它 session 的 profileId）。 */
  readonly profileId: string | undefined;
}

/**
 * **纯判定**：这个已存在的标签能不能拿来复用？
 * 返回它 = 能（profile 完全一致）；返回 undefined = 不能（没有标签 / profile 对不上 / 没请求 profile）。
 */
export function pickReusableBrowserTab(
  candidate: ExistingBrowserTab | undefined,
  requestedProfileId: string | undefined
): ExistingBrowserTab | undefined {
  if (candidate === undefined) return undefined;
  const wanted = requestedProfileId?.trim() ?? '';
  if (wanted === '') return undefined;
  return candidate.profileId === wanted ? candidate : undefined;
}

/** 复用所需的**最小能力面**：`TaskComposition` 的结构子集（缺省字段 = 没这能力 → 新开，零回归）。 */
export interface BrowserTabOpenTarget {
  readonly paneLayout: {
    open(kind: 'browser', args: BrowserTabOpenArgs): unknown;
  };
  /**
   * 聚焦面板里某类标签的**最后一个** entry（`TaskComposition.lastTabEntryOfKind`）。
   * 缺省 = 拿不到已有标签 → 行为与改动前一致（新开）。
   */
  lastTabEntryOfKind?(
    kind: 'browser'
  ): { readonly tabId: string; readonly state: unknown } | undefined;
  /** 激活**指定的**那个标签（`TaskComposition.activateTabOfKind`）。 */
  activateTabOfKind?(kind: 'browser', tabId: string): unknown;
}

export interface OpenBrowserTabRequest extends BrowserTabOpenArgs {
  /**
   * 判定「同一个」用的 profile。缺省 = 由本模块按 `profileId`/`botId` + 设置快照解析
   * （与 `browser-tab-provider.onBeforeOpen` 的 `resolveOpenProfile` 同源）。
   */
  readonly reuseProfileId?: string;
  /** false = 这一入口**每次都要新开**（缺省 true = 同 profile 复用）。 */
  readonly reuseExisting?: boolean;
}

export type BrowserTabOpenOutcome =
  /** 新开了一个标签（走 `paneLayout.open`，provider 内部照旧 `createSession`） */
  | 'opened'
  /** 复用了已有标签：已导航 + 已切前台，**没有**新开、**没有** createSession */
  | 'reused'
  /** 没有可开页的 task view，什么都没做 */
  | 'unavailable';

const BROWSER_TAB_KIND = 'browser' as const;

/**
 * 在 target（= `TaskComposition`）里把 url 开出来：**能复用就复用，否则与改动前逐字节一致地新开**。
 * 不抛：任何一步失败只 warn —— 这是「尽力开页」，绝不能把渲染进程搞崩。
 */
export function openBrowserTabOrReuse(
  target: BrowserTabOpenTarget | undefined,
  request: OpenBrowserTabRequest
): BrowserTabOpenOutcome {
  if (target === undefined) return 'unavailable';

  const existing = reusableTabOf(target, request);
  if (existing !== undefined) {
    const url = request.initialUrl ?? '';
    const navigated = navigateExistingBrowserTab(existing.browserId, url);
    if (navigated) {
      activateExistingBrowserTab(target, existing.tabId);
      return 'reused';
    }
    // 拿不到导航把手（这一页的 BrowserPane 还没把 navigate 注册上来）→ 退回新开：
    // 宁可多一个标签，也不能让「打开 X」变成什么都不发生。
    console.warn('[XG-CUSTOM] 已有同 profile 的 browser 标签，但这一页暂时导航不了 → 退回新开', {
      browserId: existing.browserId,
      url,
    });
  }

  target.paneLayout.open(BROWSER_TAB_KIND, browserTabOpenArgsOf(request));
  return 'opened';
}

/** 复用判定：拿到「聚焦面板里最后一个 browser 标签」，按解析后的 profile 比一比。 */
function reusableTabOf(
  target: BrowserTabOpenTarget,
  request: OpenBrowserTabRequest
): ExistingBrowserTab | undefined {
  if (request.reuseExisting === false) return undefined;
  // 没有 url = 没有可导航的目标（`task.openBrowser` 是空白页）→ 不参与复用。
  if (request.initialUrl === undefined || request.initialUrl === '') return undefined;
  const entry = target.lastTabEntryOfKind?.(BROWSER_TAB_KIND);
  if (entry === undefined) return undefined;
  return pickReusableBrowserTab(existingBrowserTabOf(entry), reuseProfileIdOf(request));
}

/**
 * 本次请求「解析后的 profile」。带 `profileId`/`botId` 时与 `onBeforeOpen` 用**同一个**纯函数解析
 * （`botId` 未绑定时得到确定性的 `bot-<botId>`）；只读，不落盘、不建 profile —— 建 profile 仍归
 * `onBeforeOpen`（真的新开时才需要）。
 */
function reuseProfileIdOf(request: OpenBrowserTabRequest): string | undefined {
  const explicit = request.reuseProfileId?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const requestedProfileId = request.profileId?.trim() ?? '';
  const botId = request.botId?.trim() ?? '';
  const settings = getAppSettingValueSnapshot('browser');
  if (settings === undefined) {
    // 设置快照还没来（冷启动）：只认请求里**显式给的** profile（主进程解析好的那个）。
    return requestedProfileId !== '' ? requestedProfileId : undefined;
  }
  return resolveOpenProfile({
    requestedProfileId,
    botId,
    profiles: settings.profiles,
    defaultProfileId: settings.defaultProfileId,
  }).profileId;
}

/** entry.state（`BrowserState` / 快照恢复后的同形对象）→ 判定要用的最小信息；不认识就 undefined。 */
function existingBrowserTabOf(entry: {
  readonly tabId: string;
  readonly state: unknown;
}): ExistingBrowserTab | undefined {
  const state = entry.state;
  if (typeof state !== 'object' || state === null) return undefined;
  const browserId = (state as { browserId?: unknown }).browserId;
  if (typeof browserId !== 'string' || browserId === '') return undefined;
  const session = (state as { session?: unknown }).session;
  const profileId =
    typeof session === 'object' && session !== null
      ? (session as { profileId?: unknown }).profileId
      : undefined;
  return {
    tabId: entry.tabId,
    browserId,
    profileId: typeof profileId === 'string' ? profileId : undefined,
  };
}

/** 导航已开着的这一页 —— 用地址栏同一条路（`BrowserPane.navigateTo`）；false = 现在导航不了。 */
function navigateExistingBrowserTab(browserId: string, url: string): boolean {
  const controls = browserControlsRegistry.get(browserId);
  if (controls === undefined || typeof controls.navigate !== 'function') return false;
  try {
    return controls.navigate(url) === true;
  } catch (error) {
    console.warn('[XG-CUSTOM] 导航已有 browser 标签失败', { browserId, url, error });
    return false;
  }
}

function activateExistingBrowserTab(target: BrowserTabOpenTarget, tabId: string): void {
  try {
    target.activateTabOfKind?.(BROWSER_TAB_KIND, tabId);
  } catch (error) {
    // 激活失败不致命：页面已经导航过去了，只是可能不在前台。
    console.warn('[XG-CUSTOM] 激活复用的 browser 标签失败（页已导航，可能不在前台）', error);
  }
}

/** 只把**请求里真有的**字段放进 args（与改动前逐字节一致，不给上游塞多余的键）。 */
function browserTabOpenArgsOf(request: OpenBrowserTabRequest): BrowserTabOpenArgs {
  const args: { initialUrl?: string; profileId?: string; botId?: string } = {};
  if (typeof request.initialUrl === 'string' && request.initialUrl !== '') {
    args.initialUrl = request.initialUrl;
  }
  const profileId = request.profileId?.trim();
  if (profileId !== undefined && profileId !== '') args.profileId = profileId;
  const botId = request.botId?.trim();
  if (botId !== undefined && botId !== '') args.botId = botId;
  return args;
}
