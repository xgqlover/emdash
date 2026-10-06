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
// [XG-CUSTOM] 2026-10-06 —— 「打开网址…」的快捷键（仓库既有约定：`keybinding.settings(...)`）
import { keybinding } from '@core/primitives/keybindings/api';

export const browserOpenUrlCommand = defineCommand({
  id: 'browser.openUrl',
  title: '打开网址…',
  description: '在内嵌浏览器里打开一个网址（只收 http/https；没写协议自动补 https://）',
  category: 'Browser',
  icon: 'globe',
  input: z.object({ url: z.string() }).optional(),
  // [XG-CUSTOM] 2026-10-06 —— 快捷键 `Mod+Shift+U`：**在 task view 里按一下**就弹「打开网址…」框
  //   （用户要的"快入口"；与 `task.openBrowser` 的 `Mod+Shift+B` 同族、同在 `view.task` scope）。
  //   · 注册方式照抄现成命令（`keybinding.settings(settingsKey, 默认键)`）—— 聚合处是
  //     `core/manifests/shared/command-catalog.ts`（已含 `BROWSER_COMMAND_DEFS`），
  //     `KeybindingService` 直接读 `COMMAND_CATALOG.defs`，所以**没有**别的清单要改。
  //   · settingsKey 用 `openUrl`：`command-catalog.test.ts` 会查 key 唯一性，全仓此前没有这个 key。
  //   · 键位冲突：全仓 `Mod+Shift+U` 未被占用（`command-catalog.test.ts` 的 same-scope 冲突用例会兜底）。
  //   · 绑定以 `undefined` 调用（`keybinding-dispatcher` 就是这么发的）→ 走 `planOpenUrlCommand`
  //     的 `prompt` 分支 → 弹既有输入框；这条命令的 input 本来就是 `.optional()`，无需改动。
  keybinding: keybinding.settings('openUrl', 'Mod+Shift+U'),
});

export const BROWSER_COMMAND_DEFS = [browserOpenUrlCommand] as const;
