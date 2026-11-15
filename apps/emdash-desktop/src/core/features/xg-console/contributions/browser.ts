// [XG-CUSTOM 2026-11-17] 中控台视图注册
import { xgConsoleViewRuntime } from '../browser/console-view';

export const xgConsoleBrowserContributions = {
  views: [xgConsoleViewRuntime],
} as const;
