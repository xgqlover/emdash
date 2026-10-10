// [XG-CUSTOM 2026-10-11] 「自动化」视图 Tab 的取值口径 —— **纯函数、零依赖**（可单测）。
//
// 为什么单独一个文件（真机事故，别合回去）：
//   这段判断原来**内联在 `useState` 的初始化器里**，而初始化器在**首次渲染时立即执行**，
//   却引用了同一函数体里**下方 7 行才声明**的 `params` ⇒ **TDZ ReferenceError**
//   ⇒ React 渲染抛错 ⇒ 被包着整个 app 的 `ErrorBoundary` 接住
//   ⇒ 用户看到整页「Emdash couldn't display that view / Reload to try again with your saved layout」。
//   ⚠️ **`tsc --noEmit` 抓不到它**：引用在回调里，TS 不报"用在前、声明在后"。
//   ⇒ 唯一可靠的防线是「**先声明再使用**」+ 把判断抽成纯函数让单测兜住。
//
// 语义：只认显式合法值，其余一律回落 `automations`（从左侧栏进来时 params 里没有 tab）。

export type XgTab = 'automations' | 'kaneo' | 'workrally';

export const XG_TABS: readonly XgTab[] = ['automations', 'kaneo', 'workrally'] as const;

export const XG_TAB_DEFAULT: XgTab = 'automations';

/** 这个值是不是合法的 Tab？ */
export function isXgTab(v: unknown): v is XgTab {
  return v === 'automations' || v === 'kaneo' || v === 'workrally';
}

/** 任意入参 → 合法 Tab（认不出就回落默认）。 */
export function xgTabOf(v: unknown): XgTab {
  return isXgTab(v) ? v : XG_TAB_DEFAULT;
}
