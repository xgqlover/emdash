// [XG-CUSTOM] 2026-10-06 —— 让「打开网址…」出现在 Ctrl+K 命令面板里（不额外造 UI 基础设施）。
//   aliases 里同时给中英文关键词，中文界面下搜「打开/网址」、英文习惯搜「open url」都能命中。
import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { browserOpenUrlCommand } from './commands';

export const BROWSER_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({
    command: browserOpenUrlCommand,
    aliases: ['open url', 'open website', 'open link', 'url', '打开网址', '网址', '浏览器'],
  }),
] as const;
