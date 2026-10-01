// [XG-CUSTOM] 项我控制球 API 适配层。
//
// 移植自开源项目 mini-yifan/deepseek-harness-orb（MIT）的 apps/desktop/renderer/floating.js：
// 它原来所有后端调用都走 `rpc(method, args)` → `fetch('dsh-app://app/api/<method>')`。
// 我们把它换成 `window.electronAPI.orbApi(method, args)`（preload）→
// `ipcMain.handle('xiangwo:orb-api')` → 本模块按 method 路由到 emdash / 项我后端。
//
// 球窗口的状态机与几何仍在 ./xiangwo-orb.ts；本模块只做"方法 → 宿主能力"的翻译，
// 依赖通过 OrbApiDeps 注入，避免 xiangwo-orb.ts ↔ 本文件 的循环 import。
import { Menu, app, ipcMain, shell, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@main/lib/logger';

/** 球相对工作区的展开方向（渲染进程据此加 expand-left/right/up/down 类） */
export type OrbDirection = { horizontal: 'left' | 'right'; vertical: 'up' | 'down' };

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

/** 读头像：meta 里的 dataUrl 优先，其次 userData 里的字节文件；都没有 → 空串（用内置「项」） */
function readAvatarUrl(): string {
  const meta = readJsonObject(orbFile(ORB_AVATAR_META_FILE));
  if (typeof meta.dataUrl === 'string' && meta.dataUrl.startsWith('data:image/')) return meta.dataUrl;
  for (const name of ORB_AVATAR_BYTES) {
    try {
      const file = orbFile(name);
      const bytes = readFileSync(file);
      if (bytes.byteLength === 0 || bytes.byteLength > ORB_AVATAR_MAX_BYTES) continue;
      const mime = name.endsWith('.gif')
        ? 'image/gif'
        : name.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
      return `data:${mime};base64,${bytes.toString('base64')}`;
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
function orbOverlayModel(): { provider: string; model: string } {
  return { provider: 'xiangwo', model: process.env.XIANGWO_MODEL ?? 'xiangwo-8900' };
}

/** TCC（macOS 屏幕录制/辅助功能授权）在 Linux/Windows 无此概念 → 永远"已授权" */
const TCC_READY_STATUS = { applicable: false, screen: 'granted', accessibility: 'granted' };

/** [XG-CUSTOM] 球右键菜单里能被选中的动作（渲染进程据此执行，主进程只负责弹菜单） */
export type OrbContextMenuAction = 'open-main' | 'toggle-panel' | 'quit';

/**
 * [XG-CUSTOM] 球的原生右键菜单（Electron 内置 Menu，零新依赖）。
 *
 * 为什么不用自绘 DOM：球窗口在收起态只有 96×96 DIP，而且被 X11 SHAPE 抠成一颗圆
 * （这台机器的合成器起不来 → 形状外"没有窗口"）。自绘菜单在那个窗口里根本画不出来：
 * 缩在圆里看不见，把窗口放大又会在形状外露出黑边（没有合成器就没有真正的透明）。
 * 原生菜单是独立的 X 窗口，收起/展开两个状态都能用，位置默认跟随鼠标，点外部/ESC 由系统关闭。
 * @param win 球窗口（菜单宿主；拿不到就退化成"无宿主弹窗"）
 * @returns 被点中的动作 id；点外部 / ESC / 没选中 = null
 */
function popupOrbContextMenu(win: BrowserWindow | null): Promise<OrbContextMenuAction | null> {
  return new Promise((resolve) => {
    let picked: OrbContextMenuAction | null = null;
    const pick = (action: OrbContextMenuAction) => () => {
      picked = action;
    };
    const menu = Menu.buildFromTemplate([
      { label: '打开主窗口', click: pick('open-main') },
      { label: '打开/收起面板', click: pick('toggle-panel') },
      { type: 'separator' },
      { label: '退出项我球', click: pick('quit') },
    ]);
    menu.popup({
      ...(win !== null && !win.isDestroyed() ? { window: win } : {}),
      callback: () => {
        log.info('[xiangwo-orb] context menu closed', { picked });
        resolve(picked);
      },
    });
  });
}

/**
 * 按 method 路由一次球 API 调用。
 *
 * 已实现：floating.setExpanded / move / clamp / unsnap / contextMenu / sessionId / setSessionId /
 * setSessionRunning / overlayPermission / setOverlayPermission / overlayModel / avatarUrl /
 * orbWorkspacePath / relaunch / onCreateSession，backend.status / subscribe。
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
      return popupOrbContextMenu(deps.getWindow());
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
    case 'floating.avatarUrl':
      return readAvatarUrl();
    case 'floating.setAvatar': {
      const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';
      if (dataUrl === '' || !dataUrl.startsWith('data:image/')) {
        return readAvatarUrl();
      }
      if (Buffer.byteLength(dataUrl, 'utf8') > ORB_AVATAR_MAX_BYTES * 2) return readAvatarUrl();
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
