import { defineContract, eventStream, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  BrowserDataClearKind,
  BrowserEvent,
  BrowsingDataKind,
} from '@core/primitives/browser/api';

type BrowserActionResult = { success: boolean; error?: string };

export const browserDomain = 'browser' as const;

export const browserContract = defineContract({
  registerSession: procedure({
    input: z.object({ browserId: z.string(), partition: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  unregisterSession: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  bindWebContents: procedure({
    input: z.object({ browserId: z.string(), webContentsId: z.number() }),
    output: z.custom<BrowserActionResult>(),
  }),
  setActiveBrowser: procedure({
    input: z.object({ browserId: z.string().nullable() }),
    output: z.custom<BrowserActionResult>(),
  }),
  getActiveBrowser: procedure({
    input: z.void(),
    output: z.object({ browserId: z.string().nullable() }),
  }),
  openDevTools: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  captureScreenshot: procedure({
    input: z.object({ browserId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearData: procedure({
    input: z.object({ browserId: z.string(), kind: z.custom<BrowserDataClearKind>() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearProfileStorage: procedure({
    input: z.object({ profileId: z.string() }),
    output: z.custom<BrowserActionResult>(),
  }),
  clearBrowsingData: procedure({
    input: z.object({ kind: z.custom<BrowsingDataKind>() }),
    output: z.custom<BrowserActionResult>(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<BrowserEvent>() }),
  // [XG-CUSTOM 2026-10-12] 「从零开页」的**回执**：主窗口渲染进程干完 `openEmbeddedBrowserTab`
  // 之后，把**真实结果**送回主进程（成功 / 带可判别原因的失败：`no-task` / `no-task-view` /
  // `unavailable`）。为什么必须有这条：开页是主进程 → 渲染进程的一条广播（fire-and-forget），
  // 主进程原来根本拿不到结果 ⇒ 球里点链接失败时**完全静默**（详情见
  // `main/host/browser/embedded-browser-open-ack.ts` 的文件头）。
  // 主进程侧的消费者：`main/host/browser/controller.ts` —— 落地球那边的等待，并在**真的开成**时
  // 把主窗提上来（只在主窗隐藏/最小化时，不抢焦点，见 `revealMainWindowIfHidden`）。
  // 只有带 `requestId` 的开页事件才回执（球那条路）；agent 9223 桥 / 反向通道不回执 ⇒ 零回归。
  reportEmbeddedBrowserOpenResult: procedure({
    input: z.object({
      requestId: z.string(),
      ok: z.boolean(),
      reason: z.string().optional(),
    }),
    output: z.custom<{ accepted: boolean }>(),
  }),
});
