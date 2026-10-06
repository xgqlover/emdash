// [XG-CUSTOM] 2026-10-06 —— 「打开网址…」命令（id `browser.openUrl`）。
//
// 为什么要加它（用户真机反馈）：用户想「在 emdash 里打开一个网址」，
// 点工具栏那颗按钮弹出来的是 **Forward Port**（把远端端口隧道到本机预览 dev server，5173 是占位），
// 那条路不是「打开网址」。这条命令才是：**输入/粘贴一个 http(s) 网址 → 在当前 task 的「浏览器」面板里打开**。
//
// input 用 `.optional()` 是**硬要求**，不是随手写的：
//   命令面板里选中一项只能以 `undefined` 调用（`defineCommandPaletteCatalog` 要求
//   `input.safeParse(undefined).success`），所以「没带 url → 弹输入框」这条路必须存在
//   （决策在 `../browser/open-url-command.ts` 的 `planOpenUrlCommand`，纯函数、有单测）。
import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';

export const browserOpenUrlCommand = defineCommand({
  id: 'browser.openUrl',
  title: '打开网址…',
  description: '在内嵌浏览器里打开一个网址（只收 http/https；没写协议自动补 https://）',
  category: 'Browser',
  icon: 'globe',
  input: z.object({ url: z.string() }).optional(),
});

export const BROWSER_COMMAND_DEFS = [browserOpenUrlCommand] as const;
