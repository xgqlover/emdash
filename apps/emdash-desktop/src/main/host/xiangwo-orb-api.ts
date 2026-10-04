// [XG-CUSTOM] 项我控制球 API 适配层。
//
// 移植自开源项目 mini-yifan/deepseek-harness-orb（MIT）的 apps/desktop/renderer/floating.js：
// 它原来所有后端调用都走 `rpc(method, args)` → `fetch('dsh-app://app/api/<method>')`。
// 我们把它换成 `window.electronAPI.orbApi(method, args)`（preload）→
// `ipcMain.handle('xiangwo:orb-api')` → 本模块按 method 路由到 emdash / 项我后端。
//
// 球窗口的状态机与几何仍在 ./xiangwo-orb.ts；本模块只做"方法 → 宿主能力"的翻译，
// 依赖通过 OrbApiDeps 注入，避免 xiangwo-orb.ts ↔ 本文件 的循环 import。
import {
  Menu,
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { log } from '@main/lib/logger';

/** 球相对工作区的展开方向（渲染进程据此加 expand-left/right/up/down 类） */
export type OrbDirection = { horizontal: 'left' | 'right'; vertical: 'up' | 'down' };

/**
 * [XG-CUSTOM 2026-10-03] 球里「点图片卡片 → 在内嵌浏览器打开来源页」的要打开请求。
 * `bot` 选填（带了就落到该 bot 的浏览器 profile，与 agent 开页同一个维度）；不带 = default。
 */
export type OrbOpenEmbeddedBrowserRequest = { url: string; bot?: string };

/**
 * [XG-CUSTOM 2026-10-03] 「开内嵌浏览器」的真实实现（由 boot 注入，见
 * main/bootstrap/boot/phases/background.ts 的 configureOrbEmbeddedBrowserOpen 调用）。
 * **不在主进程另造开页机制**：接到的是 wiring.ts 的 `requestEmbeddedBrowserOpen` —— 也就是
 * agent 9223 桥 / 反向通道用的同一条「从零开页」广播（`open-in-embedded-browser` →
 * 主窗口的 `openEmbeddedBrowserTab`，见 core/features/workbench/api/browser/
 * embedded-browser-open-request.ts）。null = 还没注入（单测复位也用它）。
 */
let openEmbeddedBrowserImpl: ((request: OrbOpenEmbeddedBrowserRequest) => boolean) | null = null;

/**
 * 注入「开内嵌浏览器」实现（boot 调一次）。传 null = 复位（单测用）。
 * @param open 收到 {url, bot} 返回"广播是否已发出"（best-effort，等待绑定在渲染进程侧）
 */
export function configureOrbEmbeddedBrowserOpen(
  open: ((request: OrbOpenEmbeddedBrowserRequest) => boolean) | null
): void {
  openEmbeddedBrowserImpl = open;
}

/** 球原点（屏幕坐标，球本身左上角） */
export type OrbBallPoint = { x: number; y: number };

/**
 * [XG-CUSTOM] 停靠侧 = 球吸在屏幕哪一条边（照上游 FloatingDockSide）。
 * 停靠的语义：窗口滑出屏幕外，只在屏内留一条 ORB_DOCK_TAB_WIDTH 的细条。
 */
export type OrbDockSide = 'left' | 'right';

/** [XG-CUSTOM] 停靠态：侧别 + 球顶 y（细条对齐到球原来的高度） */
export type OrbDock = { side: OrbDockSide; y: number };

/**
 * [XG-CUSTOM] 一次 move/clamp/unsnap 的结果。
 * `docked` 必须**透传给渲染进程**（orb.js 靠它切 body.docked-* + 点亮/熄灭 #dock-tab）。
 * `dockRefused` = 本来已经压住屏幕边、但因为「运行中/提问卡待答」被护栏拒了 ——
 * 渲染进程据此给可见反馈（真机复现：运行中拖到边缘毫无反应，用户只会以为功能坏了）。
 */
export type OrbBallOutcome = {
  ball?: OrbBallPoint;
  docked: OrbDockSide | null;
  dockRefused?: boolean;
};

/** 本模块需要球壳提供的能力（见 xiangwo-orb.ts） */
export type OrbApiDeps = {
  /** 展开/收起球窗口，返回展开方向（收起时返回值被渲染进程忽略） */
  applyMode: (mode: 'ball' | 'panel') => OrbDirection;
  /** 把球原点移到 (x, y)，返回落点 + 当前停靠侧 */
  moveBall: (x: number, y: number) => OrbBallOutcome;
  /** 松手/夹回：允许停靠就吸边，否则夹回工作区；返回落点 + 停靠侧 */
  clampBall: (canDock: boolean) => Promise<OrbBallOutcome> | OrbBallOutcome;
  /** 从停靠细条滑回球态（没停靠就是 no-op）；返回 `{ docked: null }` */
  unsnapBall: () => Promise<OrbBallOutcome> | OrbBallOutcome;
  /** 球窗口（原生右键菜单的宿主窗口） */
  getWindow: () => BrowserWindow | null;
};

/** 权限档（与 Orb 一致，也与我们的档位一致） */
const ORB_PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const;
type OrbPermissionPreset = (typeof ORB_PERMISSION_PRESETS)[number];
const DEFAULT_ORB_PERMISSION: OrbPermissionPreset = 'danger-full-access';

/** 会话标记文件（放在 userData/xiangwo-orb.json 旁边） */
const ORB_SESSION_FILE = 'xiangwo-orb-session.json';
/**
 * 权限档文件（放在 userData/xiangwo-orb.json 旁边）
 */
const ORB_PERMISSION_FILE = 'xiangwo-orb-permission.json';
/**
 * [XG-CUSTOM] 球头像（照上游 orb-avatar.ts 的思路，简化成"字节 + meta 一个文件"）：
 * 换头像 = 往 userData 里放 `xiangwo-orb-avatar.png|gif|webp`（或写 `xiangwo-orb-avatar.json`
 * 里的 dataUrl），上限 2MB；没放就返回空串，球继续用内置的「项」字（不是空白）✓
 */
const ORB_AVATAR_META_FILE = 'xiangwo-orb-avatar.json';
const ORB_AVATAR_BYTES = ['xiangwo-orb-avatar.png', 'xiangwo-orb-avatar.gif', 'xiangwo-orb-avatar.webp'];
const ORB_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/**
 * [XG-CUSTOM] 模型选择的落盘文件。**注意**：8900 实测不支持选模型（见 `orbModelCatalog`），
 * 所以菜单项是 disabled 的，这个文件目前只在 `supported` 变真的时候才会被读；
 * 写进去的值不影响真实推理（服务端只回显 model 字段）。
 */
const ORB_MODELS_FILE = 'xiangwo-orb-models.json';
/**
 * [XG-CUSTOM] 划词工具条开关（照上游 selection-toolbar-config.ts，默认开 = 与现状一致）
 */
const ORB_SELECTION_FILE = 'xiangwo-orb-selection.json';

type OrbSessionState = { sessionId?: string; running?: boolean };

function orbFile(name: string): string {
  return join(app.getPath('userData'), name);
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    /* 没存过 / 写坏了就当空 */
  }
  return {};
}

function writeJsonObject(file: string, value: Record<string, unknown>): void {
  try {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch {
    /* 写失败不影响使用 */
  }
}

function isPermissionPreset(value: unknown): value is OrbPermissionPreset {
  return typeof value === 'string' && (ORB_PERMISSION_PRESETS as readonly string[]).includes(value);
}

/** 读持久化的会话标记 */
function readSession(): OrbSessionState {
  const raw = readJsonObject(orbFile(ORB_SESSION_FILE));
  return {
    ...(typeof raw.sessionId === 'string' && raw.sessionId !== ''
      ? { sessionId: raw.sessionId }
      : {}),
    ...(typeof raw.running === 'boolean' ? { running: raw.running } : {}),
  };
}

function writeSession(patch: OrbSessionState): OrbSessionState {
  const next = { ...readSession(), ...patch };
  const out: Record<string, unknown> = {};
  if (next.sessionId !== undefined) out.sessionId = next.sessionId;
  if (next.running !== undefined) out.running = next.running;
  writeJsonObject(orbFile(ORB_SESSION_FILE), out);
  return next;
}

/**
 * [XG-CUSTOM] 球会话是不是正在跑（`floating.setSessionRunning` 落的盘）。
 * 用途：边缘停靠的**运行时护栏** —— 上游 `canDock = !(running || asking())`，
 * `asking()`（提问卡待答）在渲染进程；主进程只能看到 running，所以两边各守一层。
 * @returns 正在跑 = true
 */
export function orbSessionRunning(): boolean {
  return readSession().running === true;
}

/**
 * [XG-CUSTOM] 清掉落盘的 `running` 标记（建窗时调用）。
 * 为什么必须有：`running` 是**落盘**的，进程被 kill / 请求挂着没结束都会留一个 `true`；
 * 而主进程的停靠护栏读的就是它 —— 一旦残留，**吸边会永久失效**且没有任何提示
 * （真机复现的另一半原因：用户拖到屏幕边毫无反应）。渲染进程启动时 running 恒为 false，
 * 所以建窗时把这个可能过期的标记清掉，护栏只反映"本次运行"的真实状态。
 */
export function clearOrbSessionRunning(): void {
  const current = readSession();
  if (current.running !== true) return;
  writeSession({ running: false });
}

/** 读持久化的权限档（缺省 = 完全访问，跟 Orb 一致） */
function readPermission(): OrbPermissionPreset {
  const raw = readJsonObject(orbFile(ORB_PERMISSION_FILE));
  return isPermissionPreset(raw.preset) ? raw.preset : DEFAULT_ORB_PERMISSION;
}

function writePermission(preset: OrbPermissionPreset): void {
  writeJsonObject(orbFile(ORB_PERMISSION_FILE), { preset });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 球头像支持的 MIME（照上游 orb-avatar.ts） */
type OrbAvatarMime = 'image/gif' | 'image/png' | 'image/webp';

/** 换头像失败的原因（渲染进程据此给**人话**文案） */
export type OrbAvatarInstallError = 'too-large' | 'invalid-type';

const ORB_AVATAR_MIME_BY_EXTENSION: Readonly<Record<string, OrbAvatarMime>> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const ORB_AVATAR_EXTENSION_BY_MIME: Readonly<Record<OrbAvatarMime, string>> = {
  'image/gif': '.gif',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** 换头像失败的人话文案（主进程给，渲染进程直接显示；两边只维护这一份） */
export function orbAvatarErrorMessage(error: OrbAvatarInstallError): string {
  return error === 'too-large'
    ? '图片太大（超过 2MB），换一张小一点的'
    : '不是支持的图片格式（只认 gif / png / webp）';
}

/**
 * [XG-CUSTOM] 按 magic bytes 判类型（整段照抄上游 orb-avatar.ts:202-219）。
 *
 * 为什么必须有：旧版 `readAvatarUrl()` 只看**扩展名**就把字节当图片发出去 ——
 * 一个改名成 `.png` 的任意文件会被当成 PNG 喂给 `<img>`，轻则不显示、重则踩渲染器解码。
 * GIF87a/89a、PNG 的 8 字节签名、RIFF....WEBP 三段都按上游逐字节比对。
 * @param bytes 文件字节
 * @returns 识别出的 MIME；没命中三种之一 = undefined
 */
export function sniffOrbAvatarMime(bytes: Uint8Array): OrbAvatarMime | undefined {
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * [XG-CUSTOM] magic bytes + 扩展名**互相印证**（照上游 orb-avatar.ts:85-91）。
 * @param bytes 文件字节
 * @param filePath 原路径（扩展名必须与 magic 一致，否则算非法）
 * @returns MIME；magic 不认识、或扩展名与 magic 冲突 = undefined
 */
export function interpretOrbAvatarBytes(
  bytes: Uint8Array,
  filePath: string
): OrbAvatarMime | undefined {
  const sniffed = sniffOrbAvatarMime(bytes);
  if (sniffed === undefined) return undefined;
  const fromName = ORB_AVATAR_MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (fromName !== undefined && fromName !== sniffed) return undefined;
  return sniffed;
}

/** 现在有没有自定义头像（决定菜单里「恢复默认头像」是否可点）= 球上**真的显示出了**一张图 */
function hasCustomAvatar(): boolean {
  return readAvatarUrl() !== '';
}

/** 删掉三个扩展名的字节文件（换头像时清旧、恢复默认时全清） */
function removeOrbAvatarBytes(): void {
  for (const name of ORB_AVATAR_BYTES) {
    try {
      unlinkSync(orbFile(name));
    } catch {
      /* 本来就没有 = 已经是想要的状态 */
    }
  }
}

/**
 * [XG-CUSTOM] 落一盘自定义头像（照上游 orb-avatar.ts:99-131 的 install/restore）。
 *
 * 校验顺序照上游：① `statSync` 大小 ≤2MB；② magic bytes 认出类型；
 * ③ 扩展名与 magic 必须一致。三道都过才写盘（写**字节文件** + `{mime}` meta）。
 * @param filePath dialog 返回的绝对路径
 * @returns ok / 失败原因
 */
export function installOrbAvatarFromPath(
  filePath: string
): { ok: true; mime: OrbAvatarMime } | { ok: false; error: OrbAvatarInstallError } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    // dialog 给了个 stat 不到的路径 —— 当成非法图片，不抛异常
    return { ok: false, error: 'invalid-type' };
  }
  if (size > ORB_AVATAR_MAX_BYTES) return { ok: false, error: 'too-large' };
  if (size === 0) return { ok: false, error: 'invalid-type' };
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return { ok: false, error: 'invalid-type' };
  }
  const mime = interpretOrbAvatarBytes(bytes, filePath);
  if (mime === undefined) return { ok: false, error: 'invalid-type' };
  removeOrbAvatarBytes();
  writeFileSync(orbFile(`xiangwo-orb-avatar${ORB_AVATAR_EXTENSION_BY_MIME[mime]}`), bytes);
  writeJsonObject(orbFile(ORB_AVATAR_META_FILE), { mime });
  return { ok: true, mime };
}

/** [XG-CUSTOM] 恢复默认头像：删掉字节文件 + meta，球回退到内置「项」字 */
export function restoreOrbAvatar(): boolean {
  const existed = hasCustomAvatar();
  removeOrbAvatarBytes();
  try {
    unlinkSync(orbFile(ORB_AVATAR_META_FILE));
  } catch {
    /* 本来就没有 */
  }
  return existed;
}

/** MIME 白名单判断（meta 里存的必须是这三种之一） */
function isOrbAvatarMime(value: unknown): value is OrbAvatarMime {
  return value === 'image/gif' || value === 'image/png' || value === 'image/webp';
}

/**
 * 读头像：meta 里的 dataUrl 优先，其次 userData 里的字节文件；都没有 → 空串（用内置「项」）。
 *
 * [XG-CUSTOM] 字节文件这一路**必须过 magic bytes**（照上游 orb-avatar.ts:174-200 的
 * `readCustomOrbAvatar`）：
 *   · `sniffOrbAvatarMime` 认不出来（改名的文本/JPEG/随便什么字节）→ 跳过，绝不喂给 `<img>`；
 *   · meta 里存了 mime 时，它必须与 magic **一致**，不一致（盘上状态自相矛盾）→ 跳过；
 *   · 认出来就按 **magic** 的结论发 dataURL —— 真类型以字节为准，不信文件名。
 * 旧实现只看扩展名，一个改名成 `.png` 的任意文件会被当成 PNG 发出去（审计指的缺口）。
 */
function readAvatarUrl(): string {
  const meta = readJsonObject(orbFile(ORB_AVATAR_META_FILE));
  if (typeof meta.dataUrl === 'string' && /^data:image\/(?:gif|png|webp);base64,/.test(meta.dataUrl)) {
    return meta.dataUrl;
  }
  const metaMime = isOrbAvatarMime(meta.mime) ? meta.mime : undefined;
  for (const name of ORB_AVATAR_BYTES) {
    try {
      const bytes = readFileSync(orbFile(name));
      if (bytes.byteLength === 0 || bytes.byteLength > ORB_AVATAR_MAX_BYTES) continue;
      const sniffed = sniffOrbAvatarMime(bytes);
      if (sniffed === undefined) continue;
      if (metaMime !== undefined && metaMime !== sniffed) continue;
      return `data:${metaMime ?? sniffed};base64,${bytes.toString('base64')}`;
    } catch {
      /* 没这个文件就试下一个 */
    }
  }
  return '';
}

/**
 * 当前 bot 的工作空间路径（真实值，别让 UI 显示空）。
 * 可用 XIANGWO_WORKSPACE 覆盖；否则用应用目录（dev = 仓库 checkout，packaged = asar 目录）。
 */
function orbWorkspacePath(): string {
  const override = process.env.XIANGWO_WORKSPACE;
  if (typeof override === 'string' && override !== '') return override;
  try {
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

/** 我们 8900 通道背后的模型标识（真实值；渲染进程的模型菜单用它，不再显示空串） */
function orbOverlayModel(): { provider: string; model: string; reasoningEffort?: string } {
  return { provider: 'xiangwo', model: process.env.XIANGWO_MODEL ?? 'xiangwo-8900' };
}

/**
 * [XG-CUSTOM] 模型选择落盘（`userData/xiangwo-orb-models.json`），照上游 OrbAgentModelSelection。
 *
 * **重要：这个文件当前不影响任何推理**。8900 实测不支持选模型（证据见 `orbModelCatalog`），
 * 所以写进去的值只在 `supported` 变真之后才会被采纳；服务端对请求体的 `model` 字段只回显。
 */
type OrbModelSelection = { provider: string; model: string; reasoningEffort?: string };

function readOverlayModelSelection(): OrbModelSelection | undefined {
  const raw = readJsonObject(orbFile(ORB_MODELS_FILE));
  if (typeof raw.provider !== 'string' || raw.provider === '') return undefined;
  if (typeof raw.model !== 'string' || raw.model === '') return undefined;
  const selection: OrbModelSelection = { provider: raw.provider, model: raw.model };
  if (typeof raw.reasoningEffort === 'string' && raw.reasoningEffort !== '') {
    selection.reasoningEffort = raw.reasoningEffort;
  }
  return selection;
}

function writeOverlayModelSelection(selection: OrbModelSelection): void {
  const out: Record<string, unknown> = { provider: selection.provider, model: selection.model };
  if (selection.reasoningEffort !== undefined) out.reasoningEffort = selection.reasoningEffort;
  writeJsonObject(orbFile(ORB_MODELS_FILE), out);
}

/** 菜单里的一项模型 */
export type OrbCatalogModel = {
  id: string;
  name: string;
  /** 当前真实在用的一项 */
  current: boolean;
  /** 能不能点。8900 不支持切换 → 恒为 false（绝不假装能切） */
  enabled: boolean;
  /** 追加在名字后面的说明，例如「（当前唯一）」 */
  note?: string;
};

/** 模型目录（渲染进程/菜单据此渲染；`supported:false` = 只能看不能切） */
export type OrbModelCatalog = {
  /** 上游 8900 到底支不支持用请求体选模型 —— 实测结论，不是猜测 */
  supported: boolean;
  /** 当前真实路由 */
  current: OrbModelSelection;
  /** 落盘的偏好（仅供自检/诊断；`supported:false` 时无意义） */
  stored?: OrbModelSelection;
  /** 按 provider 分组（照上游 FloatingModelProviderGroup） */
  groups: Array<{ id: string; name: string; models: OrbCatalogModel[] }>;
  /** 为什么不能切（人话，菜单里以 disabled 行显示） */
  reason: string;
};

/**
 * [XG-CUSTOM] 模型目录 —— 结论来自**实测**，不是看 `/v1/models` 有几个 id 就以为能选。
 *
 * 实测（2026-10-05，本机 8900）：
 *   · `GET /v1/models` 返回 `xiangwo` / `sxsj` 两个 id，但那是 `xiangwo-agent/agent.py:6989`
 *     **硬编码**的列表，不是真实模型枚举。
 *   · 同一 prompt 只改请求体 `model`：`xiangwo` / `sxsj` / `totally-bogus-xyz` 三次返回
 *     **正文完全一致**，且 bogus 名字**不报错**（200）。
 *   · 只读溯源：`model` 只流到 `_XGSseWriter(handler, model)`（`agent.py:1611-1613` 写入、
 *     `:1675` 当响应体的 `model` 字段回显）；`_ask_question(question, route, history,
 *     session_id, source)`（`:6178`）**没有 model 形参**，真正决定模型的是自动 `route`。
 *   · `reasoning_effort` 入参不存在；`reasoning_content` 只是上游返回的思考链（会被丢弃）。
 *
 * 所以这里 `supported` 恒为 false，菜单只显示**真实在用的那一项**并标「（当前唯一）」且 disabled
 * —— 与其做一个点了没用的 checkbox 骗人，不如老实说「就这一个，按路由自动选」。
 * 哪天 8900 真支持了，把 `supported` 换成真实探测、再把 `enabled` 打开即可（其余代码已就位）。
 * @returns 模型目录
 */
export function orbModelCatalog(): OrbModelCatalog {
  const current = orbOverlayModel();
  const stored = readOverlayModelSelection();
  return {
    supported: false,
    current,
    ...(stored !== undefined ? { stored } : {}),
    groups: [
      {
        id: current.provider,
        name: '项我 8900（实测不支持选模型）',
        models: [
          {
            id: current.model,
            name: current.model,
            current: true,
            enabled: false,
            note: '（当前唯一）',
          },
        ],
      },
    ],
    reason: '8900 按路由自动选模型，请求体 model 仅回显',
  };
}

/**
 * [XG-CUSTOM] 划词工具条开关（照上游 selection-toolbar-config.ts，默认 **true** = 与现状一致，
 * 不给老用户静默改行为）。渲染进程启动时读一次，决定要不要 `wireSelectionBar()`。
 */
function readSelectionToolbarEnabled(): boolean {
  const raw = readJsonObject(orbFile(ORB_SELECTION_FILE));
  return typeof raw.enabled === 'boolean' ? raw.enabled : true;
}

function writeSelectionToolbarEnabled(enabled: boolean): boolean {
  writeJsonObject(orbFile(ORB_SELECTION_FILE), { enabled });
  return enabled;
}

/** TCC（macOS 屏幕录制/辅助功能授权）在 Linux/Windows 无此概念 → 永远"已授权" */
const TCC_READY_STATUS = { applicable: false, screen: 'granted', accessibility: 'granted' };

/** [XG-CUSTOM] 球右键菜单里能被选中的动作（渲染进程据此执行，主进程只负责弹菜单） */
export type OrbContextMenuAction =
  | 'open-main'
  | 'toggle-panel'
  | 'quit'
  | 'pick-avatar'
  | 'restore-avatar'
  | 'toggle-selection';

/** 换头像 / 划词开关要回传的值：`avatarChanged` 让渲染进程知道要不要重刷 `<img id="ball-avatar">` */
export type OrbContextMenuResult = {
  action: OrbContextMenuAction | 'none';
  /** 头像或开关真的落了盘 → 渲染进程重新拉一次 `floating.avatarUrl` */
  avatarChanged?: boolean;
  /** 失败人话文案（太大了 / 不是支持的格式） */
  message?: string;
  /** 划词工具条的最新开关值 */
  selectionEnabled?: boolean;
};

/** 渲染进程报上来的「当前焦点是不是可编辑」+ 剪贴板动作可用性（照上游 FloatingContextEditState） */
type OrbEditState = { editable: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean };

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readEditState(payload: Record<string, unknown>): OrbEditState {
  const editable = asBoolean(payload.editable);
  const flags = asRecord(payload.editFlags);
  return {
    editable,
    // 渲染进程没报具体标志位时，退化成"可编辑就有选区动作"（不猜剪贴板内容）
    canCut: asBoolean(flags.canCut, editable),
    canCopy: asBoolean(flags.canCopy, editable),
    canPaste: asBoolean(flags.canPaste, editable),
  };
}

/**
 * [XG-CUSTOM] 模型子菜单（结构照上游 floating-agent-menu.ts:44-116，内容按实测做诚实版）。
 *
 * 上游用 `type:'checkbox'` 勾选当前项；只有带 reasoning 的才用 `✓ ` + 子菜单（因为 thinking
 * 父项不能用 Electron 的 `checked`）。我们这里**没有** reasoning（8900 不支持 reasoning_effort），
 * 而且**唯一一项本来就不可点**，所以统一用「`✓ ` 前缀 + enabled:false」表达"当前就是这个"。
 * @param catalog 模型目录
 * @param pick 点选回调（`supported:false` 时永远不会被调用）
 * @returns 子菜单项；至少含一行说明，绝不返回空数组
 */
function orbModelMenuItems(
  catalog: OrbModelCatalog,
  pick: (selection: OrbModelSelection) => void
): MenuItemConstructorOptions[] {
  if (catalog.groups.length === 0) return [{ label: '没有可用的模型', enabled: false }];
  const items: MenuItemConstructorOptions[] = [];
  for (const group of catalog.groups) {
    items.push({ label: group.name, enabled: false });
    for (const model of group.models) {
      const mark = model.current ? '✓ ' : '';
      // [XG-CUSTOM] 当前项不能用 `type:'checkbox'`：那一项恰好是 disabled 的，
      // 而 disabled 的 checkbox 在 Linux 上是灰勾，看起来像"没勾上"。用文字前缀最不会误读。
      items.push({
        label: `${mark}${model.name}${model.note ?? ''}`,
        enabled: model.enabled,
        click: () => pick({ provider: group.id, model: model.id }),
      });
    }
  }
  items.push({ type: 'separator' });
  items.push({ label: catalog.reason, enabled: false });
  return items;
}

/**
 * [XG-CUSTOM] 球的原生右键菜单（Electron 内置 Menu，零新依赖）。
 *
 * 为什么不用自绘 DOM：球窗口在收起态只有 96×96 DIP，而且被 X11 SHAPE 抠成一颗圆
 * （这台机器的合成器起不来 → 形状外"没有窗口"）。自绘菜单在那个窗口里根本画不出来：
 * 缩在圆里看不见，把窗口放大又会在形状外露出黑边（没有合成器就没有真正的透明）。
 * 原生菜单是独立的 X 窗口，收起/展开两个状态都能用，位置默认跟随鼠标，点外部/ESC 由系统关闭。
 *
 * 模板顺序照上游 floating-window.ts:105-128：**可编辑时把 cut/copy/paste 插在最顶上**，
 * 然后才是打开主窗 / 面板 / 模型 / 头像 / 划词开关 / 退出。
 * @param win 球窗口（菜单宿主；拿不到就退化成"无宿主弹窗"）
 * @param payload 渲染进程报上来的 editState（可选）
 * @returns 被点中的动作 + 需要回传渲染进程的数据；点外部 / ESC = `{ action:'none' }`
 */
async function popupOrbContextMenu(
  win: BrowserWindow | null,
  payload: Record<string, unknown>
): Promise<OrbContextMenuResult> {
  const edit = readEditState(payload);
  const selectionEnabled = readSelectionToolbarEnabled();
  const catalog = orbModelCatalog();
  let picked: OrbContextMenuAction | null = null;
  const pick = (action: OrbContextMenuAction) => () => {
    picked = action;
  };
  const actions: MenuItemConstructorOptions[] = [
    { label: '打开主窗口', click: pick('open-main') },
    { label: '打开/收起面板', click: pick('toggle-panel') },
    { type: 'separator' },
    {
      // [XG-CUSTOM] 模型菜单：8900 不支持切换，所以子菜单里那一项是 disabled 的
      // （实测结论见 orbModelCatalog），只用来告诉用户"现在到底用的是哪个"。
      label: '模型',
      submenu: orbModelMenuItems(catalog, (selection) => {
        writeOverlayModelSelection(selection);
      }),
    },
    { label: '换头像…', click: pick('pick-avatar') },
    {
      label: '恢复默认头像',
      enabled: hasCustomAvatar(),
      click: pick('restore-avatar'),
    },
    { type: 'separator' },
    {
      // [XG-CUSTOM] 划词工具条开关（照上游 selection-toolbar 的 enable/disable 两态文案）
      label: selectionEnabled ? '停用划词工具条' : '启用划词工具条',
      click: pick('toggle-selection'),
    },
    { type: 'separator' },
    { label: '退出项我球', click: pick('quit') },
  ];
  // [XG-CUSTOM] 可编辑（输入框/contenteditable 有焦点）才插 cut/copy/paste（照上游 :120-128）
  const template: MenuItemConstructorOptions[] = edit.editable
    ? [
        { role: 'cut', enabled: edit.canCut },
        { role: 'copy', enabled: edit.canCopy },
        { role: 'paste', enabled: edit.canPaste },
        { type: 'separator' },
        ...actions,
      ]
    : actions;
  if (process.env.XIANGWO_ORB_TRACE !== '0') {
    log.warn('[xiangwo-orb-trace] context-menu-template', {
      editable: edit.editable,
      selectionEnabled,
      models: catalog.supported,
    });
  }
  const chosen = await new Promise<OrbContextMenuAction | null>((resolve) => {
    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      ...(win !== null && !win.isDestroyed() ? { window: win } : {}),
      callback: () => {
        resolve(picked);
      },
    });
  });
  log.info('[xiangwo-orb] context menu closed', { picked: chosen });
  // [XG-CUSTOM] 「换头像…」的 dialog 放在**菜单关掉之后**才弹：在菜单 click 回调里直接
  // showOpenDialog 会和正在关闭的原生菜单抢焦点（菜单关不干净/对话框在菜单后面）。
  if (chosen === 'pick-avatar') return await pickOrbAvatar(win);
  if (chosen === 'restore-avatar') return { action: chosen, avatarChanged: restoreOrbAvatar() };
  if (chosen === 'toggle-selection') {
    return { action: chosen, selectionEnabled: writeSelectionToolbarEnabled(!selectionEnabled) };
  }
  return chosen === null ? { action: 'none' } : { action: chosen };
}

/**
 * [XG-CUSTOM] 「换头像…」：主进程开文件框 → magic bytes 校验 → 落盘。
 *
 * 校验/失败文案统一由 `installOrbAvatarFromPath` + `orbAvatarErrorMessage` 负责
 * （太大 >2MB / 不是 gif-png-webp / 扩展名与 magic 不符）。
 * @param win 对话框父窗口
 * @returns 回传渲染进程的结果（`avatarChanged` 决定要不要重刷球的 `<img>`）
 */
async function pickOrbAvatar(win: BrowserWindow | null): Promise<OrbContextMenuResult> {
  const parent = win !== null && !win.isDestroyed() ? win : undefined;
  let filePath: string | undefined;
  try {
    const result = await (parent === undefined
      ? dialog.showOpenDialog({
          title: '选一张球头像（gif / png / webp，≤2MB）',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['gif', 'png', 'webp'] }],
        })
      : dialog.showOpenDialog(parent, {
          title: '选一张球头像（gif / png / webp，≤2MB）',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['gif', 'png', 'webp'] }],
        }));
    if (result.canceled || result.filePaths.length === 0) return { action: 'pick-avatar' };
    filePath = result.filePaths[0];
  } catch (cause) {
    log.warn('[xiangwo-orb] 换头像：打开文件框失败', { cause });
    return { action: 'pick-avatar', message: '打不开文件选择框，再试一次' };
  }
  const installed = installOrbAvatarFromPath(filePath);
  if (!installed.ok) {
    return { action: 'pick-avatar', message: orbAvatarErrorMessage(installed.error) };
  }
  return { action: 'pick-avatar', avatarChanged: true };
}


/**
 * 按 method 路由一次球 API 调用。
 *
 * 已实现：floating.setExpanded / move / clamp / unsnap / contextMenu / sessionId / setSessionId /
 * setSessionRunning / overlayPermission / setOverlayPermission / overlayModel / modelCatalog /
 * setOverlayModel / avatarUrl / setAvatar / selectionToolbar / orbWorkspacePath / relaunch /
 * onCreateSession，backend.status / subscribe。
 * 换头像（dialog + magic-byte 校验 + 落盘）与划词开关的**写**都在 `floating.contextMenu` 内部完成。
 * no-op（Linux/Windows 无此概念，返回不报错的值）：tccStatus / openTcc /
 * onSelectionPrompt / onSelectionAttach。
 *
 * [XG-CUSTOM] floating.move / clamp / unsnap 都会带回 `docked`（'left' | 'right' | null）；
 * clamp 还会叠加主进程的 running 护栏（正在跑会话时**不许停靠**）。
 * @param deps 球壳注入的能力
 * @param method floating.* / backend.* 方法名
 * @param args 方法参数
 * @returns 方法结果（结构化克隆友好）
 */
export async function routeOrbApi(
  deps: OrbApiDeps,
  method: unknown,
  args: unknown
): Promise<unknown> {
  const name = typeof method === 'string' ? method : '';
  const payload = asRecord(args);
  switch (name) {
    case 'floating.setExpanded': {
      const expanded = payload.expanded !== false;
      // [XG-CUSTOM][TEMP-TRACE] 渲染进程来的三条尺寸相关路径，入参原样记录（查"窗口被撑大"）
      log.warn('[xiangwo-orb-trace] main-api', { method: name, args: payload });
      return deps.applyMode(expanded ? 'panel' : 'ball');
    }
    case 'floating.move': {
      const x = asFiniteNumber(payload.x);
      const y = asFiniteNumber(payload.y);
      log.warn('[xiangwo-orb-trace] main-api', { method: name, args: payload });
      if (x === undefined || y === undefined) return { docked: null };
      const moved = deps.moveBall(x, y);
      return { x: moved.ball?.x, y: moved.ball?.y, docked: moved.docked };
    }
    case 'floating.clamp': {
      log.warn('[xiangwo-orb-trace] main-api', { method: name, args: payload });
      // [XG-CUSTOM] canDock = 渲染进程的 !(running || asking()) && 主进程的 !running
      const clamped = await deps.clampBall(payload.canDock !== false && !orbSessionRunning());
      return {
        x: clamped.ball?.x,
        y: clamped.ball?.y,
        docked: clamped.docked,
        dockRefused: clamped.dockRefused === true,
      };
    }
    case 'floating.contextMenu':
      return popupOrbContextMenu(deps.getWindow(), payload);
    // [XG-CUSTOM][TEMP-TRACE] 渲染进程排查日志（真机"展开态点球没反应"）。XIANGWO_ORB_TRACE=0 关。
    // 定位完之后连同 xiangwo-orb.ts 的 orbTrace 与 orb.js 的 trace() 一起删。
    // 必须用 **warn** 级：文件日志（~/.config/emdash/logs/emdash.log）只落 warn/error，
    // 用 info 会被静默丢掉 —— 上一轮"trace 读不到"就是这个原因（不是 IPC 没通）。
    case 'debug.trace': {
      if (process.env.XIANGWO_ORB_TRACE !== '0') {
        log.warn('[xiangwo-orb-trace] renderer', payload);
      }
      return true;
    }
    // [XG-CUSTOM] 边缘停靠：细条滑回球态（主进程做 300ms easeOutCubic 动画 + 重抠球形状 + 落盘）
    case 'floating.unsnap': {
      const unsnapped = await deps.unsnapBall();
      return { ok: true, docked: unsnapped.docked };
    }
    case 'floating.sessionId':
      return readSession().sessionId ?? null;
    case 'floating.setSessionId': {
      const id = typeof payload.id === 'string' ? payload.id : '';
      return writeSession({ sessionId: id }).sessionId ?? null;
    }
    case 'floating.setSessionRunning': {
      return writeSession({ running: payload.running === true }).running === true;
    }
    case 'floating.overlayPermission':
      return readPermission();
    case 'floating.setOverlayPermission': {
      const preset = payload.preset;
      if (!isPermissionPreset(preset)) return readPermission();
      writePermission(preset);
      return preset;
    }
    // [XG-CUSTOM] 不再返回空档：模型/头像/工作区都给**真实值**
    case 'floating.overlayModel':
      return orbOverlayModel();
    // [XG-CUSTOM] 模型目录（右键菜单「模型」子菜单的数据源；`supported:false` = 只能看不能切）
    case 'floating.modelCatalog':
      return orbModelCatalog();
    // [XG-CUSTOM] 落盘模型偏好。菜单在 `supported:false` 时**不点它**（选项 disabled），
    // 但接口按自检要求保持可用 + 真正落盘/读回；也顺手挡住"目录里没有的模型"。
    case 'floating.setOverlayModel': {
      const provider = typeof payload.provider === 'string' ? payload.provider : '';
      const model = typeof payload.model === 'string' ? payload.model : '';
      const catalog = orbModelCatalog();
      const known = catalog.groups.some(
        (group) => group.id === provider && group.models.some((item) => item.id === model)
      );
      if (!known) return catalog.current;
      const selection: OrbModelSelection = { provider, model };
      if (typeof payload.reasoningEffort === 'string' && payload.reasoningEffort !== '') {
        selection.reasoningEffort = payload.reasoningEffort;
      }
      writeOverlayModelSelection(selection);
      return readOverlayModelSelection() ?? catalog.current;
    }
    case 'floating.avatarUrl':
      return readAvatarUrl();
    // [XG-CUSTOM] 划词工具条开关（落盘布尔；渲染进程启动时读一次决定要不要 wireSelectionBar）。
    // 没有对应的 set：**唯一的写入口是右键菜单**（主进程落盘后把新值回传给渲染进程）。
    case 'floating.selectionToolbar':
      return readSelectionToolbarEnabled();
    // [XG-CUSTOM] dataUrl 这一路（渲染进程手上已经有字节时用，例如拖拽）也要过 magic bytes：
    // 声明是 PNG 但字节其实是别的 → 直接拒掉，不写盘（旧实现只检查 `data:image/` 前缀）。
    case 'floating.setAvatar': {
      const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';
      const match = /^data:(image\/(?:gif|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (match === null) return readAvatarUrl();
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > ORB_AVATAR_MAX_BYTES) return readAvatarUrl();
      if (sniffOrbAvatarMime(bytes) !== match[1]) return readAvatarUrl();
      removeOrbAvatarBytes();
      writeJsonObject(orbFile(ORB_AVATAR_META_FILE), { dataUrl });
      return readAvatarUrl();
    }
    case 'floating.orbWorkspacePath':
      return orbWorkspacePath();
    // [XG-CUSTOM] 划词工具条要用：把 URL 交给系统默认浏览器（orb 页面没有 openExternal 桥）
    case 'host.openExternal': {
      const url = typeof payload.url === 'string' ? payload.url : '';
      if (url === '' || !/^https?:\/\//.test(url)) return false;
      void shell.openExternal(url);
      return true;
    }
    // [XG-CUSTOM 2026-10-03] 图片网格的整卡点击：在 emdash **内嵌浏览器**里打开来源作品页
    // （不是系统浏览器 —— 球面板不该因此离开）。通道 = boot 注入的 requestEmbeddedBrowserOpen，
    // 与 agent 的 9223 桥 / 反向通道**完全同一条**「从零开页」广播；没注入/地址不合法就如实
    // 回 ok:false（不假装成功，也不悄悄换开法）。
    case 'host.openEmbeddedBrowser': {
      const url = typeof payload.url === 'string' ? payload.url.trim() : '';
      if (url === '' || !/^https?:\/\//.test(url)) return { ok: false, reason: 'bad-url' };
      const bot = typeof payload.bot === 'string' ? payload.bot.trim() : '';
      const open = openEmbeddedBrowserImpl;
      if (open === null) return { ok: false, reason: 'unavailable' };
      return { ok: open(bot === '' ? { url } : { url, bot }) };
    }
    case 'floating.relaunch':
      app.relaunch();
      app.exit(0);
      return true;
    case 'floating.tccStatus':
    case 'floating.openTcc':
      return TCC_READY_STATUS;
    // 订阅类：我们不做选区工具条，返回空值即可（渲染进程不会挂在上面）。
    case 'floating.onSelectionPrompt':
    case 'floating.onSelectionAttach':
      return null;
    case 'floating.onCreateSession':
      return {};
    case 'backend.subscribe':
      return { ok: true };
    // 让球 UI 不卡在 loading（原来等 dsh 的 backend 就绪）。
    case 'backend.status':
      return { state: 'ready', phase: 'ready' };
    default:
      console.warn(`[xiangwo-orb] unknown orb api method: ${name}`);
      return null;
  }
}

/**
 * 注册 `xiangwo:orb-api` IPC（渲染进程 → 主进程的唯一球 API 入口）。
 * @param deps 球壳注入的能力
 */
export function registerXiangwoOrbApi(deps: OrbApiDeps): void {
  ipcMain.handle('xiangwo:orb-api', (_event, method: unknown, args: unknown) =>
    routeOrbApi(deps, method, args)
  );
}
