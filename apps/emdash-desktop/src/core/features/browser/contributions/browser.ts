// [XG-CUSTOM] 2026-10-06 —— browser slice 的 modal 贡献（目前只有「打开网址」输入框）。
//   约定：新 modal 由所属 slice 的 contributions/browser.ts 暴露，
//   再由 `src/core/manifests/browser/browser-contributions.ts` 聚合（本仓 AGENTS.md 的硬要求）。
import { openUrlModal } from '../browser/open-url-modal';

export const browserBrowserContributions = {
  views: [],
  modalDefs: [openUrlModal],
} as const;
