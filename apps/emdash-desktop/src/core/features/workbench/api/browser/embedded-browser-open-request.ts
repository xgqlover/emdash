// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
//
// 「从零开一个内嵌浏览器页」—— 渲染进程这一半。
//
// ── 为什么必须有这一半（不许改成主进程自建 WebContentsView）─────────────────────
// emdash 的内嵌浏览器是**渲染进程的 `<webview>`**：它 attach 到主窗口时走
// `main/host/window.ts` 的 `did-attach-webview` → `browserWebContentsRegistry.handleWebviewAttached`
// （进 pending 集合、做硬化）→ 渲染进程再 `bindWebContents(browserId, webContentsId)` 绑上
// browserId。只有绑过的 webContents 才进 `listBoundBrowsers()`，也就是 9223 CDP 白名单。
// 主进程若自己 `new WebContentsView()`，它**进不了 pending 集合 → bindWebContents 直接返回 false**，
// 要让它可见就得松开那道白名单闸门（安全敏感）。所以「开页的人」只能是渲染进程。
//
// ── 抄的是 HippoBuddy 的哪一段 ────────────────────────────────────────────────
// HippoBuddy `src/main/resources/static/js/markdown-renderer.js:205-217` 扫
// `[XG-PREVIEW]url[/XG-PREVIEW]` → `window.xgPreviewUrl(url)`（`workspace-manager.js:1190`）
// → `filePreview.showBrowser(url)` 自动把页面开进内嵌浏览器基座。我们这里把「触发源」
// 从「扫回复正文」换成**主进程的一条事件**（`BrowserEvent: open-in-embedded-browser`），
// 好处是**同步、可等待、可回话**：主进程能等 `<webview>` 真被绑定后再告诉 agent「可以操作了」，
// 而扫正文只能在整轮回复结束时才发现标记（agent 当轮就没法接着 click/fill）。
//
// ── 边界（与 9223 桥逐字一致）────────────────────────────────────────────────
// 这里只调 `taskView.paneLayout.open('browser', { initialUrl })` —— 开出来的仍然是一个普通
// 内嵌浏览器标签页，主窗口/对话页不在可达范围内；不新增任何主进程能力。
import { useEffect } from 'react';
import { getBrowserClient } from '@core/features/browser/api/browser/client';
// [XG-CUSTOM] 2026-10-06 —— 复用开页：同一个 task 里已有同 profile 的 browser 标签 → 导航它，不叠新的。
import { openBrowserTabOrReuse } from '@core/features/browser/api/browser/open-browser-tab';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
// [XG-CUSTOM 2026-10-12] **失败要进 `emdash.log`**：原来这三条路只有 `console.warn`
//   （渲染进程的 console 不进 emdash.log），所以"点了链接没反应"在日志里查不到任何痕迹。
//   这是仓库的标准 slice logger（`console.warn` + Wire 转发到主进程 file-logger，二合一）。
import { log } from '@core/primitives/logging/browser/logger';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { getTaskComposition } from './task-composition-selectors';

type TaskRef = { readonly projectId: string; readonly taskId: string };

/**
 * [XG-CUSTOM 2026-10-12] 「从零开页」的结果 —— **从 boolean 改成可判别的原因码**。
 *
 * 为什么必须改：球里点链接那条路要**把失败说出来**（原来只回一个 `false`/`{ok:true}`，
 * 失败完全静默）；而且原因要能**原样带回球侧**（球按 reason 决定说哪一句人话），
 * 所以这里给的是稳定的小写码，不是给日志看的长句。
 *   · `no-task`      = emdash 里一个可见 task 都没有（内嵌浏览器标签页必须挂在 task view 下）
 *   · `no-task-view` = 找到了 task，但拿不到它的 view（还没 provision 完 / 组合器还没建好）
 *   · `unavailable`  = task view 在，但开页/导航这条路没成（见 `openBrowserTabOrReuse`）
 */
export type OpenEmbeddedBrowserOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-task' | 'no-task-view' | 'unavailable' };

/** 主窗口当前正在看的 task（不是 task 视图 / 参数不全 → undefined）。 */
function currentTaskRef(): TaskRef | undefined {
  const ref = getNavigation().currentRef;
  if (ref.viewId !== 'task') return undefined;
  const params = ref.params as { projectId?: unknown; taskId?: unknown };
  if (typeof params.projectId !== 'string' || typeof params.taskId !== 'string') return undefined;
  return { projectId: params.projectId, taskId: params.taskId };
}

/**
 * 这次「从零开页」应该开在哪个 task view 里。
 *
 * [XG-CUSTOM] 2026-10-05 —— **先认 bot 自己的 project** —— 用户明确要求：
 *   在球里 @sxsj 说「打开网址」，就该开在 **sxsj 那个 project 的 task** 里，
 *   而不是「我屏幕上当前正在看哪个 task」。
 *   真机病根（2026-10-05）：用户在球里 @sxsj 打开网址，页落进了 **babado 的「译文」任务** ——
 *   旧实现只看 `getNavigation().currentRef`，而球面板的请求里**没有 task 身份**
 *   （`renderer/XiangwoFloatingPanel.tsx` 只发 `messages` + `[XIANGWO_ROUTE=R0][XIANGWO_SOURCE=sidebar]`）。
 *   emdash 里 **`project.id` 就是 botId**（`sxsj` / `babado` / …，见 `emdash4.db` 的 projects 表），
 *   所以拿 botId 去 `visibleTaskEntries` 里找同 project 的 task 即可（同一个 project 有多个 task 时取
 *   侧边栏第一个，够用且可预期）。
 *   botId 找不到对应 project（**内部 bot**：`xg-fetch` / `xg-fetch-cold*` 这类没有 project 的）
 *   → 退回旧行为（当前 task），零回归 —— 它们靠"复用已有页"干活，不该因为找不到 project 就失败。
 *
 * 找不到 bot 的 task 时：优先**当前正在看的 task**（不动用户视野）；否则退到侧边栏第一个可见 task
 * 并**导航过去**（"自动出现"必须真上屏：`<webview>` 只有被渲染才会 attach → 才会被绑定）。
 * 一个 task 都没有 → undefined，调用方如实回报失败，不假装成功。
 */
/**
 * [XG-CUSTOM 2026-10-05] **目标 task 的选择（纯函数，可离线测）** —— 从 `resolveTargetTask` 抽出。
 *
 * 为什么要有它（用户报的真问题）：agent 经 emdash 通道开页时**只在后台跑、用户看不到**。
 * 根因：`resolveTargetTask` 带 `botId` 时**优先开进 bot 自己的 task**（隔离设计，本该如此），
 * 但"**用户要看**"这个场景也走了同一条路 ⇒ 页开在用户视野之外。
 *
 * 语义（两种意图分开）：
 *   · `presentToUser=true`（用户明确要求看 / 球上点击卡片）→ **开在用户当前 task**；
 *     当前没 task 才退到第一个（且必须导航过去）。
 *   · `presentToUser=false`（agent 自发查资料）→ **维持原行为**：先 bot 自己的 task（隔离），
 *     再当前，最后第一个 —— 与改动前逐字节一致。
 */
export interface PickTargetTaskInput {
  /** 用户要求看（true）/ agent 自用（false） */
  readonly presentToUser: boolean;
  /** 用户当前视野里的 task */
  readonly current?: { projectId: string; taskId: string } | undefined;
  /** 按 botId 找到的、该 bot 自己的 task（隔离用） */
  readonly botEntry?: { projectId: string; taskId: string } | undefined;
  /** 兜底：可见的第一个 task */
  readonly first?: { projectId: string; taskId: string } | undefined;
}

export interface PickedTargetTask {
  readonly ref: { projectId: string; taskId: string };
  readonly needsNavigation: boolean;
}

export function pickTargetTask(input: PickTargetTaskInput): PickedTargetTask | undefined {
  const { current, botEntry, first, presentToUser } = input;
  const same = (
    a: { projectId: string; taskId: string },
    b: { projectId: string; taskId: string }
  ) => a.projectId === b.projectId && a.taskId === b.taskId;

  // ① 用户要看 → 优先当前视野（已经在看的话不需要导航）
  if (presentToUser) {
    if (current !== undefined) return { ref: current, needsNavigation: false };
    if (first !== undefined) return { ref: first, needsNavigation: true };
    return undefined;
  }

  // ② agent 自用 → 维持原行为：bot 自己的 task 优先（隔离）
  if (botEntry !== undefined) {
    const alreadyThere = current !== undefined && same(current, botEntry);
    return { ref: botEntry, needsNavigation: !alreadyThere };
  }
  if (current !== undefined) return { ref: current, needsNavigation: false };
  if (first !== undefined) return { ref: first, needsNavigation: true };
  return undefined;
}

function resolveTargetTask(
  botId?: string,
  presentToUser = false
): { ref: TaskRef; needsNavigation: boolean } | undefined {
  // [XG-CUSTOM 2026-10-05] 决策逻辑抽到纯函数 `pickTargetTask`（可离线测）；
  // 这里只负责"收集输入"：当前视野 / 按 botId 找到的 bot task / 可见的第一个。
  const current = currentTaskRef();
  const wanted = typeof botId === 'string' ? botId.trim() : '';
  const entries = getSidebarStore().visibleTaskEntries;
  const mine = wanted === '' ? undefined : entries.find((entry) => entry.projectId === wanted);
  const first = entries[0];
  return pickTargetTask({
    presentToUser,
    ...(current !== undefined
      ? { current: { projectId: current.projectId, taskId: current.taskId } }
      : {}),
    ...(mine !== undefined ? { botEntry: { projectId: mine.projectId, taskId: mine.taskId } } : {}),
    ...(first !== undefined ? { first: { projectId: first.projectId, taskId: first.taskId } } : {}),
  });
}

/**
 * 按请求把 url 开进一个内嵌浏览器标签页。返回**结果**（调用方拿它回报/记日志）。
 * 不抛：任何一步失败都只 warn —— 这是「尽力自动开页」，绝不能把渲染进程搞崩。
 *
 * [XG-CUSTOM 2026-10-12] 返回类型 `boolean` → `{ok, reason}`：`reason` 会被主进程原样回给球
 * （球里点链接时显示一句人话），所以**原因码要稳定**（见 `OpenEmbeddedBrowserOutcome`）。
 *
 * [XG-CUSTOM] bot ⟷ profile：`profileId` 由主进程按 bot 解析好塞在事件里；不带 →
 * `paneLayout.open('browser', { initialUrl })`，与改动前逐字节一致（渲染进程用 defaultProfileId）。
 * [XG-CUSTOM 2026-10-03] `botId` 也一起透传：开页的 provider 要按它按需建/复用该 bot 的
 * profile（未绑定时建 `bot-<botId>`），否则 agent 用 bot 身份开的页会落到 default，
 * `/json/list` 里 `profile`/`botId` 永远为空。
 * [XG-CUSTOM] 2026-10-05 —— `botId` 同时决定**开在哪个 task 下**（见 `resolveTargetTask`）：
 * 页开进 bot 自己的 project 的 task，而不是用户当前视野里的那个 task。
 */
export function openEmbeddedBrowserTab(
  url: string,
  profileId?: string,
  botId?: string,
  // [XG-CUSTOM 2026-10-06] **默认 true** —— 用户的话：「我跟哪个 bot 聊天，他打开的不是自己 bot 仓下
  //   聊天下面的网页吗」⇒ 默认就开在**用户正在看的那个 task**（= 他聊天的那个 bot 的会话下面）。
  //   要回到"agent 自用、开在 bot 自己 task"的隔离行为 → 显式传 false。
  presentToUser = true
): OpenEmbeddedBrowserOutcome {
  // [XG-CUSTOM 2026-10-05] presentToUser=true（用户要看）→ 开在**用户当前 task**，见 pickTargetTask
  const target = resolveTargetTask(botId, presentToUser);
  if (target === undefined) {
    log.warn(
      '[XG-CUSTOM] 项我要开内嵌浏览器，但 emdash 里没有任何 task（内嵌浏览器标签页挂在 task view 下）',
      { url, reason: 'no-task' }
    );
    return { ok: false, reason: 'no-task' };
  }
  if (target.needsNavigation) {
    getNavigation().navigate(taskViewDef(target.ref));
  }
  const taskView = getTaskComposition(target.ref.projectId, target.ref.taskId);
  if (taskView === undefined) {
    log.warn('[XG-CUSTOM] 找到 task 但拿不到它的 view（可能还没 provision 完）', {
      ...target.ref,
      url,
      reason: 'no-task-view',
    });
    return { ok: false, reason: 'no-task-view' };
  }
  // [XG-CUSTOM] 2026-10-06 —— **同一个 task 里已有同 profile 的 browser 标签 → 导航它，不叠新标签**。
  //   病根（用户真机实证）：球/agent 每说一次「打开 X」都会走到这里，而 `paneLayout.open` 对
  //   `mount:'multi'` 的 browser provider = **每次新开一个 session** ⇒ 同一个 jagda.or.jp 叠了 4 个标签。
  //   复用判定 / 导航都在 open-browser-tab.ts（纯判定有单测）；profile 不一致（别的 bot）仍新开 ——
  //   跨 profile 复用 = 串身份/串登录态。拿不到已有页或导航不了时行为与改动前逐字节一致（新开）。
  const outcome = openBrowserTabOrReuse(taskView, {
    initialUrl: url,
    ...(typeof profileId === 'string' && profileId.trim() !== ''
      ? { profileId: profileId.trim() }
      : {}),
    ...(typeof botId === 'string' && botId.trim() !== '' ? { botId: botId.trim() } : {}),
  });
  // [XG-CUSTOM] 2026-10-06 —— **切到前台**：新开的那条路（`paneLayout.open` 只把面板开/复用出来、
  //   新标签自己会激活，但整块面板不一定是当前主面板）仍要激活一下 —— 这是改动前就有的行为，别丢。
  //   复用那条路已经由 open-browser-tab.ts 精确激活了**命中的那一个**标签，这里不能再调
  //   `activateLastTabOfKind`（它会去激活"最后一个"，可能是别的 profile 的页）。
  if (outcome === 'opened') {
    try {
      taskView.activateLastTabOfKind('browser');
    } catch (error) {
      log.warn('[XG-CUSTOM] 激活 browser 标签失败（页面已开，可能不在前台）', error);
    }
  }
  taskView.setFocusedRegion('main');
  return outcome === 'unavailable' ? { ok: false, reason: 'unavailable' } : { ok: true };
}

/**
 * [XG-CUSTOM 2026-10-12] 把开页结果**回执**给主进程（Wire：`browser.reportEmbeddedBrowserOpenResult`）。
 *
 * 不抛、不阻塞：回执失败 = 球那边等超时后收到 `timeout`（照样有回执文案，只是不能说清是哪一种），
 * 所以这里只记一行日志就够，绝不能因为回执失败影响开页本身。
 * @param client 已经在订阅里拿到的 browser 域客户端（复用，不再拉一次连接）
 */
async function reportEmbeddedBrowserOpenResult(
  client: Awaited<ReturnType<typeof getBrowserClient>>,
  requestId: string,
  outcome: OpenEmbeddedBrowserOutcome
): Promise<void> {
  try {
    await client.reportEmbeddedBrowserOpenResult({
      requestId,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
  } catch (error) {
    log.warn('[XG-CUSTOM] 回执「内嵌浏览器开页结果」失败（球侧会按超时处理）', {
      requestId,
      error,
    });
  }
}

/**
 * 挂一次即可（`renderer/App.tsx`）：订阅主进程的「从零开页」事件。
 * 与 `BrowserTabResource` 的 `open-in-new-tab` 订阅互补 —— 那个要有**已存在**的标签页才订阅得上，
 * 这条的意义恰恰是「一个都不存在」。
 */
export function useEmbeddedBrowserOpenRequests(): void {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const client = await getBrowserClient();
        const off = await client.events.subscribe(undefined, {
          onEvent: (event) => {
            if (event.type !== 'open-in-embedded-browser') return;
            // [XG-CUSTOM 2026-10-05] 用户要看的页 → presentToUser（agent 自用则不带，维持隔离）
            const present = 'presentToUser' in event && event.presentToUser === true;
            const outcome = openEmbeddedBrowserTab(
              event.url,
              event.profileId,
              event.botId,
              present
            );
            // [XG-CUSTOM 2026-10-12] **把真实结果回给主进程**（只有发起方在等的那些请求才带
            // `requestId` —— 球里点链接/图片卡就是这条路；agent 9223 桥 / 反向通道不带 ⇒ 不回执，
            // 与改动前逐字节一致）。主进程拿它落地球那边的等待（球据此显示失败回执），
            // 并在真的开成时把主窗提上来（见 main/host/browser/controller.ts）。
            if ('requestId' in event && typeof event.requestId === 'string' && event.requestId !== '') {
              void reportEmbeddedBrowserOpenResult(client, event.requestId, outcome);
            }
          },
          onGap: () => {},
        });
        if (disposed) off();
        else unsubscribe = off;
      } catch (error) {
        log.warn('[XG-CUSTOM] 订阅内嵌浏览器开页事件失败（从零开页不可用）', error);
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
}
