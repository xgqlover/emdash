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
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { getTaskComposition } from './task-composition-selectors';

type TaskRef = { readonly projectId: string; readonly taskId: string };

/**
 * 这次「从零开页」应该开在哪个 task view 里。
 *
 * 优先**当前正在看的 task**（不动用户视野）；否则退到侧边栏第一个可见 task 并**导航过去**
 * （"自动出现"必须真上屏：`<webview>` 只有被渲染才会 attach → 才会被绑定）。
 * 一个 task 都没有 → undefined，调用方如实回报失败，不假装成功。
 */
function resolveTargetTask(): { ref: TaskRef; needsNavigation: boolean } | undefined {
  const ref = getNavigation().currentRef;
  if (ref.viewId === 'task') {
    const params = ref.params as { projectId?: unknown; taskId?: unknown };
    if (typeof params.projectId === 'string' && typeof params.taskId === 'string') {
      return {
        ref: { projectId: params.projectId, taskId: params.taskId },
        needsNavigation: false,
      };
    }
  }
  const first = getSidebarStore().visibleTaskEntries[0];
  if (first === undefined) return undefined;
  return {
    ref: { projectId: first.projectId, taskId: first.taskId },
    needsNavigation: true,
  };
}

/**
 * 按请求把 url 开进一个内嵌浏览器标签页。返回是否成功（调用方只用于日志/回报）。
 * 不抛：任何一步失败都只 warn —— 这是「尽力自动开页」，绝不能把渲染进程搞崩。
 *
 * [XG-CUSTOM] bot ⟷ profile：`profileId` 由主进程按 bot 解析好塞在事件里；不带 →
 * `paneLayout.open('browser', { initialUrl })`，与改动前逐字节一致（渲染进程用 defaultProfileId）。
 */
export function openEmbeddedBrowserTab(url: string, profileId?: string): boolean {
  const target = resolveTargetTask();
  if (target === undefined) {
    console.warn(
      '[XG-CUSTOM] 项我要开内嵌浏览器，但 emdash 里没有任何 task（内嵌浏览器标签页挂在 task view 下）',
      { url }
    );
    return false;
  }
  if (target.needsNavigation) {
    getNavigation().navigate(taskViewDef(target.ref));
  }
  const taskView = getTaskComposition(target.ref.projectId, target.ref.taskId);
  if (taskView === undefined) {
    console.warn('[XG-CUSTOM] 找到 task 但拿不到它的 view（可能还没 provision 完）', {
      ...target.ref,
      url,
    });
    return false;
  }
  taskView.paneLayout.open('browser', {
    initialUrl: url,
    ...(typeof profileId === 'string' && profileId.trim() !== ''
      ? { profileId: profileId.trim() }
      : {}),
  });
  taskView.setFocusedRegion('main');
  return true;
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
            openEmbeddedBrowserTab(event.url, event.profileId);
          },
          onGap: () => {},
        });
        if (disposed) off();
        else unsubscribe = off;
      } catch (error) {
        console.warn('[XG-CUSTOM] 订阅内嵌浏览器开页事件失败（从零开页不可用）', error);
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
}
