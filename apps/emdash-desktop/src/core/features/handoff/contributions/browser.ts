// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
import { handoffViewRuntime } from '../browser/handoff-view';

export const handoffBrowserContributions = {
  views: [handoffViewRuntime],
} as const;
