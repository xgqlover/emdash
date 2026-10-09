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

// [XG-CUSTOM 2026-10-08] Kaneo 看板（「自动化」视图的 Kaneo 面板）。
// 数据源 = xiangwo-agent/kaneo_board.py board（走 host 桥接，与 expertRoster 同款）。
export interface KaneoBoardCard {
  id: string;
  title: string;
  column: string;
  /** 空串 / 'r1-parent' / 'r1-expert' —— 面板上要能一眼认出 R1 卡 */
  r1: string;
  /** "已完成/总数"，如 "0/2" */
  subtasks: string;
}
export interface KaneoBoardProject {
  projectId: string;
  workspace: string;
  workspaceSlug: string;
  name: string;
  count: number;
  columns: string[];
  cards: KaneoBoardCard[];
}
/** [XG-CUSTOM 2026-10-09] 「**全流程一屏**」—— 数据源 `xiangwo-agent/kaneo_board.py::_pipeline()`。
 *
 *  为什么要它（用户原话：「**能让我有 emdash 一个平台上就能控制好这个所有流程的**」）：
 *  原面板只有 Kaneo 概览（卡数 / 列徽章 / Archify 图）⇒ **看不到出图引擎活不活、
 *  图片线 worker 开没开、有没有卡卡在冷却里** —— 等于只看了一半流程。
 *
 *  🔴 读数纪律（与 `kaneo_board.py` 一致）：
 *  · `ok: false` 一律表示**取不到**（≠ 没有数据）—— 本项目踩过 6 次「空 ≠ 失败」
 *  · `shell.busy` 可以是 **`null`**（= 问不到壳），**别当 `false` 用**
 *  · 这些数字全是**只读探活**，打开面板**不会**占用 GPU / 不触发生成
 */
export interface KaneoPipeline {
  /** 出图引擎（Win 上的 ComfyUI） */
  engine: {
    ok: boolean;
    url: string;
    version: string;
    vram_free_gb: number;
    vram_total_gb: number;
    ram_free_gb: number;
  };
  /** 本地真壳（comfy-openai :8199）—— **忙判断只认它**，别问门面 */
  shell: {
    ok: boolean;
    url: string;
    busy: boolean | null;
    queue_len: number;
    served: number;
    gen_timeout_s: number;
  };
  /** 图片线 worker（开关从 systemd drop-in 读，不是 os.environ） */
  worker: {
    enabled: boolean;
    mode: string;
    interval_s: number;
    cooldown_min: number;
    todo: number;
    drafts: number;
    finals: number;
    cooldown: number;
    label_exists: boolean;
    /** [XG-CUSTOM 2026-10-09] **待出图队列** —— 只列带「图片线」label 的 to-do 卡
     *  （**不是**那 243 张卡堆：用户 2026-10-08 明确否掉过"平铺卡列表"）。
     *  每项都带**失败/退避**信息 ⇒ 面板能把失败卡标红、显示原因、按钮变「重试」。 */
    queue: {
      task_id: string;
      title: string;
      /** 台账里最后一次的状态。🔴 **空串 = 从没出过图**（**不是失败**！
       *  —— 不许把"没记录"画成"失败了"，本项目踩过 6 次「空 ≠ 失败」） */
      state: string;
      /** 失败原因（**只有 `state === 'failed'` 时非空**） */
      why: string;
      /** 退避剩余秒数（`0` = 可以立刻试）。>0 时**点名仍会绕过它**（`--task-id` 的语义） */
      cooldownLeftS: number;
    }[];
    /** [XG-CUSTOM 2026-10-09] 「**最近一次出图结果**」（worker 台账最后一行）—— 一键开工后的回执 */
    last: {
      task_id: string;
      title: string;
      state: string;
      at: string;
      path: string;
      why: string;
      asset_id: string;
    } | null;
    /** [XG-CUSTOM 2026-10-09] 「**正在跑**」运行态（worker 写的；`null` = 没在跑）。
     *
     *  为什么要有：手动点「开工」后 worker 可能先在 `_wait_shell_idle` 里**排队等壳空闲**
     *  （最长 600s）—— 没有它，面板只能说"已开工"，**用户分不清它在排队还是在卡死**。
     *
     *  🔴 `stale: true` ⇒ **不许显示成"正在跑"**：进程被 kill 时**不会走 finally**，
     *  状态文件会留下。判据是**给 `pid` 探活**（`os.kill(pid,0)`），不是猜。（这是实测踩出来的：
     *  我自己 `pkill` 掉了 worker，文件还在，`running` 照样说"在等壳空闲"。） */
    running: {
      taskId: string;
      /** `starting` / `waiting_shell`（**在等壳空闲**）/ `generating` */
      phase: string;
      note: string;
      pid: number;
      ageS: number;
      /** pid 还活着吗（**探活得到，不是推断**） */
      alive: boolean;
      /** 🔴 `true` ⇒ 进程已死 **或** 超 30 分钟：面板**不许**画成"正在跑" */
      stale: boolean;
    } | null;
    error?: string;
  };
  /** 排活链 */
  dispatch: {
    enabled: boolean;
    columns: string;
    interval_s: number;
    queued: number;
    processed: number;
    last: { ts: string; title: string; action: string; expert: string; note: string } | null;
  };
  /** 最近产物（**已按内容去重**，优先留 Kaneo 卡引用的 `workrally_wr_*`） */
  artifacts: {
    name: string;
    bytes: number;
    w: number;
    h: number;
    mtime: string;
    url: string;
  }[];
}

/** [XG-CUSTOM 2026-10-09] **动作面**（写操作）—— 用户口径：「emdash 一个平台上就能控制好这个所有流程的」。
 *  `KaneoPipeline` 解决"**看得见**"，这一组解决"**动得了**"。
 *
 *  ⚠️ 两个动作都**不许做乐观假设**：面板必须看返回的 `ok` 才敢说成功
 *  （"点了就当成功"正是本项目反复踩的「空 ≠ 失败」）。 */
export interface KaneoActInput {
  action: 'create_card' | 'run_image';
  /** create_card 用 */
  projectId?: string;
  title?: string;
  prompt?: string;
  negative?: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  refImage?: string;
  /** run_image 用：点名哪张卡（留空 = 队列里的下一个） */
  taskId?: string;
  limit?: number;
}

export interface KaneoActResult {
  ok: boolean;
  error?: string;
  action?: string;
  /** create_card：新卡 id */
  taskId?: string;
  title?: string;
  fieldsSet?: number;
  labeled?: boolean;
  /** run_image：后台进程（**立刻返回** —— 一次出图 2~4 分钟，绝不能挂住 IPC） */
  pid?: number;
  limit?: number;
  log?: string;
}

export interface KaneoBoardResult {
  ok: boolean;
  error?: string | null;
  generatedAt: string;
  totals: { cards: number; projects: number; workspaces: number };
  columns: { slug: string; count: number }[];
  projects: KaneoBoardProject[];
  /** [XG-CUSTOM 2026-10-08] Archify 图清单（`图/` 下的 .html）。
   *  ⚠️ 只有元数据 + 已 URL 编码的地址 —— **HTML 本体不走 IPC**（单图 700+ KB），
   *  面板用 `<iframe src>` 指到 8900 的 `/xg/diagram/<名字>`。 */
  diagrams: { name: string; title: string; bytes: number; url: string }[];
  /** [XG-CUSTOM 2026-10-09] 全流程一屏（**可选**：老版本 python 不返回它也不会炸） */
  pipeline?: KaneoPipeline;
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
  // [XG-CUSTOM 2026-10-06] OpenDesign 窗口（设计工作台，7456）
  openOpenDesign: procedure({
    input: z.void(),
    output: z.custom<ActionResult>(),
  }),
  // [XG-CUSTOM 2026-10-09] WorkRally 本地出图参数面板窗口（8189/panel）
  openWorkRallyPanel: procedure({
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
  // [XG-CUSTOM 2026-10-08] Kaneo 看板（「自动化」视图的 Kaneo 面板）
  kaneoBoard: procedure({
    input: z.object({ brief: z.boolean().optional() }),
    output: z.custom<KaneoBoardResult>(),
  }),
  // [XG-CUSTOM 2026-10-09] Kaneo 看板的**动作面**（建卡 / 一键开工）——
  // 落到 `kaneo_board.py act --json '<payload>'`（JSON 走 argv 数组，桥接用 spawn 不走 shell）
  kaneoAct: procedure({
    input: z.object({
      action: z.enum(['create_card', 'run_image']),
      projectId: z.string().optional(),
      title: z.string().optional(),
      prompt: z.string().optional(),
      negative: z.string().optional(),
      model: z.string().optional(),
      size: z.string().optional(),
      aspectRatio: z.string().optional(),
      refImage: z.string().optional(),
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(4).optional(),
    }),
    output: z.custom<KaneoActResult>(),
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
