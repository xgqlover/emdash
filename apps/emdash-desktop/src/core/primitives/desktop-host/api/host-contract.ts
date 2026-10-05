import { hostFileRefSchema } from '@emdash/core/primitives/path/api';
import { defineContract, eventStream, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { TabNavigationDirection } from '@core/primitives/keybindings/api';
import type { OpenInAppId } from '@core/primitives/open-in-apps/api/open-in-apps';

/**
 * The members of node's `process.platform` union, spelled out so this
 * isomorphic contract (and its browser consumers) need no node ambient types.
 */
export const NODE_PLATFORMS = [
  'aix',
  'android',
  'cygwin',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
  'win32',
] as const;

export type NodePlatform = (typeof NODE_PLATFORMS)[number];

export interface ActiveSessionSummary {
  acpSessions: number;
  localTuiSessions: number;
  remoteSessions: number;
  terminals: number;
  incomplete: boolean;
}

export type DesktopHostEvent =
  | { type: 'menu-command'; commandId: string }
  | { type: 'menu-check-for-updates' }
  | { type: 'menu-undo' }
  | { type: 'menu-redo' }
  | {
      type: 'quit-confirmation-requested';
      requestId: string;
      summary: ActiveSessionSummary;
    }
  | { type: 'quit-confirmation-cancelled'; requestId: string }
  | { type: 'shutdown-started' }
  | { type: 'window-maximize-changed'; maximized: boolean }
  | { type: 'external-link-open-requested'; url: string }
  | {
      type: 'tab-navigation-shortcut';
      source: { kind: 'browser'; browserId: string };
      direction: TabNavigationDirection;
    }
  | {
      type: 'browser-app-shortcut';
      source: { kind: 'browser'; browserId: string };
      commandId: string;
    }
  | {
      type: 'terminal-context-menu-action';
      requestId: string;
      action: 'paste' | 'select-all' | 'clear';
    };


// [XG-CUSTOM] 专家交接平台 topic 数据模型
// ⚠️ 2026-10-05 更正真相源：`xiangwo-agent/expert_topics.json`（475KB / 319 topics）。
//    原注写的是 `wego-lite/expert-handoff/expert_topics.json` —— 那是**已废弃的副本**
//    （25KB、停在 2026-09-19、无任何 import），已归档到
//    `工作区/_归档/死交接台-2026-10-05/`。**别按旧注去找数据源。**
export interface ExpertHandoffTopic {
  id: number;
  bot: string;
  expert: string;
  title: string;
  summary: string;
  file: string;
  status: string;
  created: number;
}

// [XG-CUSTOM] 浏览器工作台 space（对应 wego-lite/task-spaces/spaces.json）
// ownership 三态沿用 ego-lite 原码：agent=agent 拥有 / agentDelegatedToUser=控制权临时交给用户
// / user=用户拥有（agent 要 claim 才能动）。与「专家交接台」是两个不同的交接口径：
// 这里交的是**页面控制权**，那里交的是**任务**。
export interface TaskSpace {
  id: number;
  name: string;
  ownership: string; // agent | agentDelegatedToUser | user
  createdBy: string;
  tabs: { title?: string; url?: string }[];
}

// [XG-CUSTOM] Pi 树专家名册（对应 xiangwo-agent/expert_roster.py 输出）
// 用途：emdash「专家总览」视图 —— Kaneo 只放有工作的 bot，全量身份看这里。
export interface ExpertRosterEntry {
  id: string;
  name: string;
  kind: string; // main | sub | role | expert | other
  parent: string;
  topics: number;
  pending: number;
  accepted: number;
  lastActive: number;
}

export interface ExpertRosterResult {
  registryError?: string | null;
  groups: { kind: string; items: ExpertRosterEntry[] }[];
  totals: {
    identities: number;
    identitiesWithWork: number;
    topics: number;
    pending: number;
    accepted: number;
    generatedAt: number;
  };
}

type ActionResult = { success: boolean; error?: string };
type RequiredPathResult = { success: true; path: string } | { success: false; error: string };
type NullablePathResult =
  | { success: true; path: string | null }
  | { success: false; error: string };
type OptionalPathResult =
  | { success: true; path: string | undefined }
  | { success: false; error: string };

export const desktopHostDomain = 'host' as const;

export const desktopHostContract = defineContract({
  openExternal: procedure({
    input: z.object({ url: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  openXiangwoFloating: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  openWeKnora: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  // [XG-CUSTOM] OpenViking 窗口
  openOpenViking: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  openT8: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  // [XG-CUSTOM] Kaneo 窗口（项我流程枢纽，5180）
  openKaneo: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  // [XG-CUSTOM] AFFiNE 窗口（知识工作台，3010）
  openAffine: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  // [XG-CUSTOM] 专家交接平台：列前专家主题 / 接下 / 删除
  expertHandoffByExpert: procedure({
    input: z.object({ expert: z.string() }),
    output: z.custom<ExpertHandoffTopic[]>(),
  }),
  expertHandoffAccept: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<ExpertHandoffTopic>(),
  }),
  expertHandoffDelete: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<{ done: boolean; id: number }>(),
  }),
  // [XG-CUSTOM] 新建交接
  expertHandoffAdd: procedure({
    input: z.object({
      bot: z.string(),
      expert: z.string(),
      title: z.string(),
      summary: z.string(),
      session: z.string(),
      context: z.string(),
    }),
    output: z.custom<ExpertHandoffTopic>(),
  }),
  expertHandoffList: procedure({
    input: z.object({ bot: z.string(), session: z.string() }),
    output: z.custom<ExpertHandoffTopic[]>(),
  }),
  // [XG-CUSTOM] 浏览器工作台（task-spaces）：页面控制权交接，与专家交接台分开的一组 procedure
  taskSpaceList: procedure({
    input: z.object({}),
    output: z.custom<TaskSpace[]>(),
  }),
  taskSpaceHandoff: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<TaskSpace>(),
  }),
  taskSpaceTakeover: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<TaskSpace>(),
  }),
  taskSpaceComplete: procedure({
    input: z.object({ id: z.string(), keep: z.boolean() }),
    output: z.custom<unknown>(),
  }),
  // [XG-CUSTOM] Pi 树专家名册（专家总览视图）
  expertRoster: procedure({
    input: z.object({}),
    output: z.custom<ExpertRosterResult>(),
  }),
  openPath: procedure({
    input: z.object({ ref: hostFileRefSchema }),
    output: z.custom<ActionResult>(),
  }),
  showWorkspaceItemInFolder: procedure({
    input: z.object({ workspaceId: z.string(), relativePath: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  clipboardWriteText: procedure({
    input: z.object({ text: z.string() }),
    output: z.custom<ActionResult>(),
  }),
  persistDroppedBlob: procedure({
    input: z.object({
      bytes: z.custom<Uint8Array>(),
      name: z.string().optional(),
      mimeType: z.string().optional(),
    }),
    output: z.custom<RequiredPathResult>(),
  }),
  persistClipboardImage: procedure({
    input: z.void(),
    output: z.custom<NullablePathResult>(),
  }),
  showTerminalContextMenu: procedure({
    input: z.object({
      requestId: z.string(),
      selectionText: z.string().nullable().optional(),
      linkText: z.string().nullable().optional(),
      x: z.number(),
      y: z.number(),
    }),
    output: z.custom<ActionResult>(),
  }),
  setMenuKeybindings: procedure({
    input: z.array(
      z.object({
        commandId: z.string(),
        title: z.string(),
        accelerator: z.string().nullable(),
      })
    ),
    output: z.void(),
  }),
  quit: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  resolveQuitConfirmation: procedure({
    input: z.object({ requestId: z.string(), confirmed: z.boolean() }),
    output: z.void(),
  }),
  ackShutdownFlush: procedure({ input: z.void(), output: z.void() }),
  shutdownReady: procedure({ input: z.void(), output: z.void() }),
  openIn: procedure({
    input: z.object({
      app: z.custom<OpenInAppId>(),
      path: z.string(),
      isRemote: z.boolean().optional(),
      sshConnectionId: z.string().nullable().optional(),
    }),
    output: z.custom<ActionResult>(),
  }),
  checkInstalledApps: procedure({
    input: z.void(),
    output: z.record(z.string(), z.boolean()),
  }),
  listInstalledFonts: procedure({
    input: z.object({ refresh: z.boolean().optional() }),
    output: z.custom<{ success: boolean; fonts: string[]; cached: boolean; error?: string }>(),
  }),
  openSelectDirectoryDialog: procedure({
    input: z.object({ title: z.string(), message: z.string(), defaultPath: z.string().optional() }),
    output: z.string().optional(),
  }),
  openSelectAudioFileDialog: procedure({
    input: z.object({ title: z.string(), message: z.string() }),
    output: z.string().optional(),
  }),
  saveTextFile: procedure({
    input: z.object({ title: z.string(), defaultPath: z.string(), content: z.string() }),
    output: z.custom<OptionalPathResult>(),
  }),
  readAudioFileDataUrl: procedure({
    input: z.object({ filePath: z.string() }),
    output: z.custom<ActionResult & { dataUrl?: string }>(),
  }),
  minimizeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  toggleMaximizeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  closeWindow: procedure({ input: z.void(), output: z.custom<ActionResult>() }),
  isWindowMaximized: procedure({ input: z.void(), output: z.boolean() }),
  getAppVersion: procedure({ input: z.void(), output: z.string() }),
  getElectronVersion: procedure({ input: z.void(), output: z.string() }),
  getPlatform: procedure({ input: z.void(), output: z.custom<NodePlatform>() }),
  getPlatformDisplayName: procedure({ input: z.void(), output: z.string() }),
  getDiagnosticLogAttachment: procedure({
    input: z.void(),
    output: z.object({
      filename: z.string(),
      mimeType: z.literal('text/plain'),
      content: z.string(),
    }),
  }),
  submitFeedback: procedure({
    input: z.object({
      content: z.string(),
      files: z.array(
        z.object({
          filename: z.string(),
          mimeType: z.string(),
          bytes: z.custom<Uint8Array>(),
        })
      ),
    }),
    output: z.custom<ActionResult>(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<DesktopHostEvent>() }),
});
