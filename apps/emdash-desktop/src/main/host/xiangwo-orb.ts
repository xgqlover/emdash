// [XG-CUSTOM] 项我控制球（orb）—— 独立置顶小窗：平时是一颗球，悬停展开成面板。
//
// 目标：球出现在 **emdash 窗口之外**（屏幕边缘常驻），点开就是 emdash 的控制入口
// （跟 bot 的 agent 聊 / 派活 / 指挥 emdash 内嵌浏览器 / 交接）。
//
// 球壳几何与交互参考开源项目 mini-yifan/deepseek-harness-orb（MIT）的 floating-window.ts：
// 影随外层窗口 96px 球、work-area 右沿中偏下起始、面板向屏内生长、右侧栏切档 screen-saver。
// 我们的差异：面板内容用移植过来的 renderer/orb/orb.html（聊天 + 📷 + 交接），并且**跨平台**都用透明球
// （Orb 在 Linux 直接不建球；我们主力是 Linux X11）。
//
// 与 window.ts 的分工：window.ts 只负责"创建 + 注册 IPC 桥"，本模块负责"球窗口的状态机 + 几何"。
// [XG-CUSTOM] 与 renderer/orb/orb.js 的契约：渲染进程只经 `electronAPI.orbApi(method, args)` 调宿主
// （路由在 ./xiangwo-orb-api.ts）；球的拖动是渲染进程自绘的（orbDrag/orbDragEnd IPC → setBounds + 落盘位置）。
import { BrowserWindow, app, ipcMain, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@main/lib/logger';
import { APP_ORIGIN } from './protocol';
import {
  orbSessionRunning,
  registerXiangwoOrbApi,
  type OrbBallOutcome,
  type OrbBallPoint,
  type OrbDock,
  type OrbDockSide,
  type OrbDirection,
} from './xiangwo-orb-api';

/** 球直径（px） */
export const ORB_BALL_SIZE = 72;
/** 球窗口比球本身大一圈，留给投影/悬停感应 */
export const ORB_CHROME_INSET = 12;
const BALL_WINDOW_SIZE = ORB_BALL_SIZE + ORB_CHROME_INSET * 2;
/** 展开面板尺寸（比 Orb 的 320×420 高，因为我们要放聊天 + 操作区） */
const PANEL_SIZE = { width: 380, height: 660 } as const;
/** [XG-CUSTOM] 面板圆角（必须与 orb.css 的 --panel-radius 一致；塑形要用它抠圆角矩形） */
const PANEL_RADIUS = 36;
/** 起始位置：work-area 垂直中偏下的比例（照 Orb 的 8%） */
const BELOW_CENTER = 0.08;
/** [XG-CUSTOM] 默认落点离屏幕边缘留 8 DIP，别让球贴着边（实测贴边看着像被切） */
const ORB_EDGE_MARGIN = 8;

// ---------------------------------------------------------------------------
// [XG-CUSTOM] 边缘停靠（dock）常量 —— 整组照开源项目 mini-yifan/deepseek-harness-orb（MIT）
// 的 floating-window.ts 搬过来（去掉了 systemPreferences / setContentProtection / CU guard）。
// 语义：拖动松手时球（收起态）压住屏幕左/右边缘 ≥ ORB_DOCK_OVERLAP → 吸边；
// 窗口滑出屏幕外，只留 ORB_DOCK_TAB_WIDTH 的细条；悬停细条 → 滑回。
// ---------------------------------------------------------------------------

/** [XG-CUSTOM] 球宽 1/5（72/5 → 14 DIP）越过屏幕左/右边缘就吸边（上游 FLOATING_DOCK_OVERLAP） */
export const ORB_DOCK_OVERLAP = Math.round(ORB_BALL_SIZE / 5);
/** [XG-CUSTOM] 拖着细条向内移超过这么多 DIP 就解锁（上游 FLOATING_DOCK_DRAG_OFF = 72/3 = 24） */
export const ORB_DOCK_DRAG_OFF = Math.round(ORB_BALL_SIZE / 3);
/** [XG-CUSTOM] 停靠后露在屏幕内的细条宽度（上游 FLOATING_DOCK_TAB_WIDTH） */
export const ORB_DOCK_TAB_WIDTH = 6;
/** [XG-CUSTOM] 细条高度 = 球直径（上游 FLOATING_DOCK_TAB_HEIGHT） */
export const ORB_DOCK_TAB_HEIGHT = ORB_BALL_SIZE;
/** [XG-CUSTOM] 吸边（球滑出屏幕）动画时长，easeInOutCubic（上游 FLOATING_DOCK_SLIDE_OFF_MS） */
export const ORB_DOCK_SLIDE_OFF_MS = 250;
/** [XG-CUSTOM] 滑回（球回到屏幕内）动画时长，easeOutCubic（上游 FLOATING_DOCK_SLIDE_IN_MS） */
export const ORB_DOCK_SLIDE_IN_MS = 300;
/** [XG-CUSTOM] 球完全滑出屏幕时的额外余量（上游 FLOATING_DOCK_OFF_GAP） */
export const ORB_DOCK_OFF_GAP = 2;
/** [XG-CUSTOM] 解锁后球离屏幕边缘的内缩（上游 FLOATING_DOCK_IN_PAD） */
export const ORB_DOCK_IN_PAD = 5;
/**
 * [XG-CUSTOM] 停靠窗口尺寸 = 细条本身（6×72）。
 *
 * 上游的命中区是 34×88（细条 6 + 内发光 8 + 20 DIP 悬停余量），多出来的是"透明但可命中"的窗口区域。
 * 这台机器没有合成器（X11 无 alpha），窗口里**没被形状覆盖**的像素是黑的 → 形状必须等于画出来的细条：
 * 细条就是窗口、窗口就是细条。代价：悬停目标只有 6 DIP 宽（见交付说明「已知限制」）。
 */
export const ORB_DOCK_HIT_WIDTH = ORB_DOCK_TAB_WIDTH;
/** [XG-CUSTOM] 停靠窗口高度 = 细条高度 */
export const ORB_DOCK_HIT_HEIGHT = ORB_DOCK_TAB_HEIGHT;

type Rect = { x: number; y: number; width: number; height: number };
type OrbMode = 'ball' | 'panel';
/** [XG-CUSTOM] 窗口当前该长什么样：球 / 面板 / 停靠细条（SHAPE 抠形与尺寸护栏都按它算） */
type OrbVisualMode = OrbMode | 'docked';

let orbWindow: BrowserWindow | null = null;
let orbMode: OrbMode = 'ball';
let pinned = false;
let openMainHandler: (() => void) | undefined;
let ipcRegistered = false;
/** [XG-CUSTOM] 展开方向（panelShape 要把"球所在那个角"的圆并进形状，见 panelShape 注释） */
let panelDirection: OrbDirection | undefined;
/** [XG-CUSTOM] 当前停靠态（undefined = 没停靠）；是渲染进程 body.docked-* 的唯一来源 */
let orbDocked: OrbDock | undefined;
/**
 * [XG-CUSTOM] 吸边/滑回动画的"代次"。动画是 await 的，期间用户可能又拖了一次
 * （cancelOrbAnim 会 resolve 掉旧动画）—— 用代次号判断"我这一趟还算不算数"。
 */
let orbDockToken = 0;
/** [XG-CUSTOM] 正在跑的窗口动画（同一时刻只允许一个） */
let orbAnim: { cancelled: boolean; resolve: () => void } | undefined;

/**
 * [XG-CUSTOM][TEMP-TRACE] 球交互排查日志（真机「展开态点球没反应」专用）。
 * XIANGWO_ORB_TRACE=0 关闭；定位完之后连同渲染进程 orb.js 的 trace() 一起删。
 */
function orbTrace(event: string, detail: Record<string, unknown> = {}): void {
  if (process.env.XIANGWO_ORB_TRACE === '0') return;
  // 必须用 **warn** 级：文件日志（~/.config/emdash/logs/emdash.log）只落 warn/error，
  // 用 info 会被静默丢掉 —— 这就是上一轮"trace 读不到"的原因（不是 IPC 没通）。
  log.warn(`[xiangwo-orb-trace] ${event}`, detail);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * [XG-CUSTOM] 落盘的位置记忆（userData/xiangwo-orb.json）。
 * 兼容旧格式：`ball` 字段名与含义不变（老版本只写它），`dock` 是停靠态新增字段
 * （`{ side: 'left'|'right', y }`，y = 球顶，用来把 6px 细条对齐到球原来的高度）。
 * 停靠时 **两个都写**：`ball` 存"解锁后球该回到哪"，`dock` 存"现在停在哪一边"。
 */
type OrbSavedState = { ball?: { x: number; y: number }; dock?: OrbDock };

function boundsFile(): string {
  return join(app.getPath('userData'), 'xiangwo-orb.json');
}

function readSavedState(): OrbSavedState {
  try {
    const raw = JSON.parse(readFileSync(boundsFile(), 'utf8')) as {
      ball?: { x: number; y: number };
      dock?: { side?: unknown; y?: unknown };
    };
    const out: OrbSavedState = {};
    if (raw?.ball && Number.isFinite(raw.ball.x) && Number.isFinite(raw.ball.y)) {
      out.ball = { x: raw.ball.x, y: raw.ball.y };
    }
    const side = raw?.dock?.side;
    const y = raw?.dock?.y;
    if ((side === 'left' || side === 'right') && typeof y === 'number' && Number.isFinite(y)) {
      out.dock = { side, y };
    }
    return out;
  } catch {
    /* 没存过 / 写坏了就当没存过 */
    return {};
  }
}

function saveOrbState(state: OrbSavedState): void {
  try {
    const out: Record<string, unknown> = {};
    if (state.ball !== undefined) out.ball = state.ball;
    if (state.dock !== undefined) out.dock = { side: state.dock.side, y: state.dock.y };
    writeFileSync(boundsFile(), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  } catch {
    /* 写失败不影响使用 */
  }
}

function workAreaFor(point: { x: number; y: number }): Rect {
  return screen.getDisplayNearestPoint(point).workArea;
}

/** [XG-CUSTOM] 屏幕边缘（不是 work-area）：细条要贴在**真正的屏幕边**上（跟上游一样用 display.bounds） */
function screenBoundsFor(point: { x: number; y: number }): Rect {
  return screen.getDisplayNearestPoint(point).bounds;
}

function displayForPoint(point: { x: number; y: number }): { bounds: Rect; workArea: Rect } {
  const display = screen.getDisplayNearestPoint(point);
  return { bounds: display.bounds, workArea: display.workArea };
}

function clampBall(ball: { x: number; y: number }, area: Rect): { x: number; y: number } {
  return {
    x: clamp(ball.x, area.x, area.x + area.width - ORB_BALL_SIZE),
    y: clamp(ball.y, area.y, area.y + area.height - ORB_BALL_SIZE),
  };
}

/**
 * 默认位置：主显示器 work-area 右沿内侧、垂直中偏下（照 Orb，但左右各留 8 DIP 边距）。
 * 注意：只在「没存过位置」时用；拖动过之后以 xiangwo-orb.json 为准。
 */
function defaultBallOrigin(area: Rect): { x: number; y: number } {
  const margin = ORB_EDGE_MARGIN;
  const right = area.x + area.width - ORB_BALL_SIZE - margin;
  const centerY = area.y + (area.height - ORB_BALL_SIZE) / 2;
  const below = Math.round(centerY + area.height * BELOW_CENTER);
  return {
    x: Math.round(clamp(right, area.x + margin, right)),
    y: Math.round(clamp(below, area.y + margin, area.y + area.height - ORB_BALL_SIZE - margin)),
  };
}

function collapsedBounds(ball: { x: number; y: number }): Rect {
  return {
    x: ball.x - ORB_CHROME_INSET,
    y: ball.y - ORB_CHROME_INSET,
    width: BALL_WINDOW_SIZE,
    height: BALL_WINDOW_SIZE,
  };
}

// ---------------------------------------------------------------------------
// [XG-CUSTOM] 边缘停靠（dock）几何 + 动画
//
// 搬自上游 floating-window.ts（MIT）：dockSideForBallOrigin / dockedTabBounds /
// offScreenBallOrigin / insideBallOrigin / animateOverlayBounds / snapToEdge / unsnapDockedBall。
// 去掉的：systemPreferences（prefersReducedMotion）、setContentProtection、CU/overlay guard。
//
// 我们的差异（必须记住，否则会踩黑块/被裁）：
// 1) 停靠窗口 = 细条本身（6×72），不是上游的 34×88 命中区 —— 没有合成器就没有"透明但可命中"。
// 2) 停靠态必须重新 setShape（X11 SHAPE 抠形）：球态是圆、停靠态是胶囊，不重抠就是一块黑或细条被裁掉。
// 3) 停靠侧别用 work-area，用屏幕边缘（display.bounds）：细条贴在真正的屏幕边上。
// ---------------------------------------------------------------------------

/** [XG-CUSTOM] 停靠细条的垂直位置：细条（72 高）贴着球原来的高度，夹进屏幕内 */
function clampBallY(ballY: number, bounds: Rect): number {
  return Math.round(clamp(ballY, bounds.y, bounds.y + bounds.height - ORB_DOCK_TAB_HEIGHT));
}

/**
 * [XG-CUSTOM] 球已经压住哪一侧屏幕边缘（压住 ≥ ORB_DOCK_OVERLAP 才算；上下边永不吸）。
 * 停靠不是拖动过程中发生的，而是松手时由 clampOrbBall 提交。
 * @param ball 球左上角（屏幕 DIP）
 * @param bounds 所在显示器的**屏幕**矩形（display.bounds，不是 workArea）
 * @returns 'left' / 'right'，压得不够（< 球宽 1/5）则 undefined
 */
export function dockSideForBallOrigin(
  ball: { readonly x: number; readonly y: number },
  bounds: Rect
): OrbDockSide | undefined {
  const leftOverlap = bounds.x - ball.x;
  const rightOverlap = ball.x + ORB_BALL_SIZE - (bounds.x + bounds.width);
  if (leftOverlap >= ORB_DOCK_OVERLAP && leftOverlap >= rightOverlap) return 'left';
  if (rightOverlap >= ORB_DOCK_OVERLAP) return 'right';
  return undefined;
}

/**
 * [XG-CUSTOM] 停靠细条在屏幕上的矩形。窗口 = 细条，所以这就是窗口 bounds。
 * 左停靠贴显示屏左沿、右停靠贴右沿内侧 ORB_DOCK_TAB_WIDTH —— 露在屏幕内的可见部分正好 6 DIP。
 * @param side 左/右屏边
 * @param ballY 球原来的顶边（用来把细条对到同一高度）
 * @param bounds 所在显示器的屏幕矩形
 */
export function dockedTabBounds(side: OrbDockSide, ballY: number, bounds: Rect): Rect {
  return {
    x: side === 'left' ? bounds.x : bounds.x + bounds.width - ORB_DOCK_TAB_WIDTH,
    y: clampBallY(ballY, bounds),
    width: ORB_DOCK_TAB_WIDTH,
    height: ORB_DOCK_TAB_HEIGHT,
  };
}

/** [XG-CUSTOM] 吸边动画的终点：球整个滑到屏幕外（再多留 ORB_DOCK_OFF_GAP） */
function offScreenBallOrigin(side: OrbDockSide, ballY: number, bounds: Rect): { x: number; y: number } {
  return {
    x:
      side === 'left'
        ? bounds.x - ORB_BALL_SIZE - ORB_DOCK_OFF_GAP
        : bounds.x + bounds.width + ORB_DOCK_OFF_GAP,
    y: clamp(Math.round(ballY), bounds.y, bounds.y + bounds.height - ORB_BALL_SIZE),
  };
}

/** [XG-CUSTOM] 解锁后球回到屏内的位置：左/右各内缩 ORB_DOCK_IN_PAD，y 夹进工作区 */
function insideBallOrigin(
  side: OrbDockSide,
  ballY: number,
  display: { readonly bounds: Rect; readonly workArea: Rect }
): { x: number; y: number } {
  return {
    x:
      side === 'left'
        ? display.bounds.x + ORB_DOCK_IN_PAD
        : display.bounds.x + display.bounds.width - ORB_BALL_SIZE - ORB_DOCK_IN_PAD,
    y: clamp(
      Math.round(ballY),
      display.workArea.y,
      display.workArea.y + display.workArea.height - ORB_BALL_SIZE
    ),
  };
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

function lerpRect(start: Rect, end: Rect, t: number): Rect {
  return {
    x: Math.round(start.x + (end.x - start.x) * t),
    y: Math.round(start.y + (end.y - start.y) * t),
    width: Math.round(start.width + (end.width - start.width) * t),
    height: Math.round(start.height + (end.height - start.height) * t),
  };
}

/** [XG-CUSTOM] 取消在跑的窗口动画（新一次吸边/滑回/拖动会打断旧的） */
function cancelOrbAnim(): void {
  const anim = orbAnim;
  if (anim === undefined) return;
  anim.cancelled = true;
  orbAnim = undefined;
  anim.resolve();
}

/**
 * [XG-CUSTOM] 逐帧把窗口 bounds 从当前位置插值到 end（16ms 一帧）。
 * 只用于**尺寸不变**的球态位移（吸边/滑回），所以直接 setBounds、不走 setOrbBounds（免得每帧记 trace）。
 * @param win 球窗口
 * @param end 目标 bounds
 * @param durationMs 时长（0 = 直接就位）
 * @param ease 缓动函数
 */
function animateOrbBounds(
  win: BrowserWindow,
  end: Rect,
  durationMs: number,
  ease: (t: number) => number
): Promise<void> {
  cancelOrbAnim();
  const start = win.getBounds();
  if (durationMs <= 0 || win.isDestroyed()) {
    if (!win.isDestroyed()) win.setBounds(end);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const anim = { cancelled: false, resolve };
    orbAnim = anim;
    const t0 = Date.now();
    const tick = (): void => {
      if (anim.cancelled) return;
      if (win.isDestroyed()) {
        if (orbAnim === anim) orbAnim = undefined;
        resolve();
        return;
      }
      const t = Math.min(1, (Date.now() - t0) / durationMs);
      win.setBounds(lerpRect(start, end, ease(t)));
      if (t < 1) {
        setTimeout(tick, 16);
        return;
      }
      if (orbAnim === anim) orbAnim = undefined;
      resolve();
    };
    setTimeout(tick, 16);
  });
}

/** [XG-CUSTOM] 窗口当前"该长什么样"：停靠 > 面板 > 球（SHAPE 与尺寸护栏都按它算） */
function visualMode(): OrbVisualMode {
  return orbDocked !== undefined ? 'docked' : orbMode;
}

/** 球窗口中心（用来找它落在哪块屏上；停靠时窗口是细条，所以按细条尺寸算） */
function orbWindowCenter(): { x: number; y: number } {
  const win = orbWindow;
  if (win === null || win.isDestroyed()) return { x: 0, y: 0 };
  const b = win.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * [XG-CUSTOM] 把窗口直接设成停靠细条（不带动画）并记下停靠态 + 落盘。
 * 顺序很重要：**先** orbDocked、再 setBounds —— 否则 resize 护栏（按 visualMode 算应有尺寸）
 * 会把刚设好的 6×72 又拉回 96×96。
 * @param win 球窗口
 * @param side 左/右屏边
 * @param ballY 球顶（细条对齐用）
 * @param bounds 所在显示器的屏幕矩形
 * @returns 实际停靠的侧别
 */
function applyDockedTab(win: BrowserWindow, side: OrbDockSide, ballY: number, bounds: Rect): OrbDockSide {
  const y = clampBallY(ballY, bounds);
  orbDocked = { side, y };
  cancelOrbAnim();
  setOrbBounds(win, dockedTabBounds(side, y, bounds), 'dockedTab');
  // [XG-CUSTOM] 停靠态也必须重抠形状（6×72 胶囊）—— 不重抠就是黑块或细条被裁
  applyOrbShape('docked');
  repaintOrbWindow(win);
  const ball = insideBallOrigin(side, y, displayForPoint(orbWindowCenter()));
  saveOrbState({ ball, dock: orbDocked });
  orbTrace('main-dock', { side, y, bounds: win.getBounds(), ball });
  return side;
}

/**
 * [XG-CUSTOM] 吸边（上游 `snapToEdge`）：球（收起态）滑出屏幕外
 * （ORB_DOCK_SLIDE_OFF_MS / easeInOutCubic）→ 收成 ORB_DOCK_TAB_WIDTH 的细条
 * + 重抠形状（X11 SHAPE）+ 落盘 + 通知渲染进程。
 * 动画期间用户又拖了一次（orbDockToken 变了）就放弃这一趟。
 * @param side 目标屏边
 * @param ballY 球顶
 * @param bounds 所在显示器的屏幕矩形
 * @returns 实际停靠的侧别；中途被打断则返回当前状态
 */
export async function snapToEdge(
  side: OrbDockSide,
  ballY: number,
  bounds: Rect
): Promise<OrbDockSide | undefined> {
  const win = orbWindow;
  if (win === null || win.isDestroyed()) return undefined;
  const token = ++orbDockToken;
  await animateOrbBounds(
    win,
    collapsedBounds(offScreenBallOrigin(side, ballY, bounds)),
    ORB_DOCK_SLIDE_OFF_MS,
    easeInOutCubic
  );
  if (win.isDestroyed() || token !== orbDockToken) return orbDocked?.side;
  return applyDockedTab(win, side, ballY, bounds);
}

/**
 * [XG-CUSTOM] 解锁：细条滑出后球滑回屏内（ORB_DOCK_SLIDE_IN_MS / easeOutCubic）+ 重抠球形状 + 落盘。
 * 不是停靠态就是 no-op（返回 `{ docked: null }`）。
 * @returns 落点 + docked:null
 */
export async function unsnapDockedBall(): Promise<OrbBallOutcome> {
  const win = orbWindow;
  const dock = orbDocked;
  if (win === null || win.isDestroyed() || dock === undefined) return { docked: null };
  const token = ++orbDockToken;
  const display = displayForPoint(orbWindowCenter());
  const start = offScreenBallOrigin(dock.side, dock.y, display.bounds);
  const end = insideBallOrigin(dock.side, dock.y, display);
  // 先清停靠态：下面这次 setBounds 会把窗口从 6×72 变回 96×96，
  // resize 护栏必须已经知道"现在是球态"，否则它会把尺寸又拉回细条。
  orbDocked = undefined;
  cancelOrbAnim();
  setOrbBounds(win, collapsedBounds(start), 'unsnap:start');
  applyOrbShape('ball');
  repaintOrbWindow(win);
  notifyMode();
  await animateOrbBounds(win, collapsedBounds(end), ORB_DOCK_SLIDE_IN_MS, easeOutCubic);
  if (win.isDestroyed() || token !== orbDockToken) return { docked: null };
  const ball = clampBall(end, display.workArea);
  setOrbBounds(win, collapsedBounds(ball), 'unsnap:end');
  applyOrbShape('ball');
  repaintOrbWindow(win);
  saveOrbState({ ball });
  notifyMode();
  orbTrace('main-unsnap', { side: dock.side, ball, bounds: win.getBounds() });
  return { ball, docked: null };
}

/** [XG-CUSTOM] 渲染进程说的 canDock + 主进程自己的运行时护栏（running 不许停靠） */
function dockAllowed(rendererCanDock: unknown): boolean {
  return rendererCanDock !== false && !orbSessionRunning();
}

/** 球相对工作区的展开方向：面板往哪边长（渲染进程据此加 expand-left/right/up/down 类） */
function orbDirection(ball: { x: number; y: number }, area: Rect): OrbDirection {
  const onRightHalf = ball.x + ORB_BALL_SIZE / 2 > area.x + area.width / 2;
  const onBottomHalf = ball.y + ORB_BALL_SIZE / 2 > area.y + area.height / 2;
  return {
    horizontal: onRightHalf ? 'left' : 'right',
    vertical: onBottomHalf ? 'up' : 'down',
  };
}

/**
 * 面板向屏幕内侧生长：球在右半屏就往左长（球锚在面板右缘），球在下半屏就往上长（球锚在面板下缘）。
 * 两个方向都夹回工作区内。
 */
function expandedBounds(ball: { x: number; y: number }, area: Rect, direction: OrbDirection): Rect {
  // 展开的目标尺寸永远是应用的规范尺寸（380×660），不管窗口曾经被 WM 改成多大
  const size = sizeForMode('panel');
  const rawX =
    direction.horizontal === 'left'
      ? ball.x + ORB_BALL_SIZE - size.width + ORB_CHROME_INSET
      : ball.x - ORB_CHROME_INSET;
  const rawY =
    direction.vertical === 'up'
      ? ball.y + ORB_BALL_SIZE - size.height + ORB_CHROME_INSET
      : ball.y - ORB_CHROME_INSET;
  return {
    x: clamp(rawX, area.x, area.x + area.width - size.width),
    y: clamp(rawY, area.y, area.y + area.height - size.height),
    width: size.width,
    height: size.height,
  };
}

/**
 * [XG-CUSTOM] 展开态球的锚点：球贴在面板哪一个角（与 orb.css 的
 * `body.expand-left/right/up/down #ball` 一一对应）。
 * - horizontal 'left'（面板向左长、球锚在面板右缘）→ x = 宽 - inset - 球径
 * - horizontal 'right' → x = inset；vertical 同理（'up' → 贴下缘）。
 *
 * **宽高必须传"窗口实际尺寸"**：WM 级缩放（DDE/KWin 的 Super+拖动、窗口规则）能绕过
 * `resizable:false` 把窗口改大，而 CSS 的 `right/bottom` 是相对**实际窗口**算的 ——
 * 用常量 380×660 算锚点，球就会跑到形状之外被 X11 SHAPE 裁掉
 * （真机「移动后球和输入药丸整条消失」的确定性根因：实测窗口已被放到 677×884 DIP）。
 * @param direction 展开方向
 * @param width 窗口实际宽（DIP）
 * @param height 窗口实际高（DIP）
 */
function ballAnchorFor(
  direction: OrbDirection,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: direction.horizontal === 'left' ? width - ORB_CHROME_INSET - ORB_BALL_SIZE : ORB_CHROME_INSET,
    y: direction.vertical === 'up' ? height - ORB_CHROME_INSET - ORB_BALL_SIZE : ORB_CHROME_INSET,
  };
}

/**
 * 当前的球锚点：按**窗口当前实际宽高** + 当前展开方向算。
 * 故意不缓存 —— 窗口尺寸可能被 WM 改，缓存过就会像常量一样出错。
 */
function orbBallAnchor(): { x: number; y: number } {
  const win = orbWindow;
  const direction = panelDirection;
  if (win !== null && !win.isDestroyed() && direction !== undefined) {
    const bounds = win.getBounds();
    return ballAnchorFor(direction, bounds.width, bounds.height);
  }
  return { x: ORB_CHROME_INSET, y: ORB_CHROME_INSET };
}

/**
 * [XG-CUSTOM] 我们自己调 setBounds 时置位；`resize` 处理器用它区分
 * 「程序设置」（正常）和「WM/用户缩放」（要拉回去）。
 * 注意：resize 事件通常是异步到达的，所以护栏不能只靠这个标志，还要比尺寸（见 resize 处理器）。
 */
let applyingBounds = false;

/** [XG-CUSTOM] 统一的 setBounds 入口：置位 applyingBounds + 记录 before/after 来源（TEMP-TRACE） */
function setOrbBounds(win: BrowserWindow, bounds: Rect, source: string): void {
  const before = win.getBounds();
  applyingBounds = true;
  try {
    win.setBounds(bounds);
  } finally {
    applyingBounds = false;
  }
  const after = win.getBounds();
  orbTrace('main-setBounds', {
    source,
    before: [before.x, before.y, before.width, before.height],
    requested: [bounds.x, bounds.y, bounds.width, bounds.height],
    after: [after.x, after.y, after.width, after.height],
    mode: orbMode,
  });
}

/** [XG-CUSTOM] 各形态应有的尺寸（球态 96×96、面板态 380×660、停靠态 6×72）——"窗口该多大"由应用说了算，WM 不许改 */
function sizeForMode(mode: OrbVisualMode): { width: number; height: number } {
  if (mode === 'docked') return { width: ORB_DOCK_HIT_WIDTH, height: ORB_DOCK_HIT_HEIGHT };
  return mode === 'panel'
    ? { width: PANEL_SIZE.width, height: PANEL_SIZE.height }
    : { width: BALL_WINDOW_SIZE, height: BALL_WINDOW_SIZE };
}

/**
 * [XG-CUSTOM] 移动/改尺寸后强制整窗重绘。
 *
 * 真机实测：球被拖走之后，**面板底部那条（输入药丸 + 球）会整片消失**——面板其余部分正常。
 * 这台机器没有合成器（Depth 24 无 alpha + X11 SHAPE 抠形），透明置顶窗在 setBounds 之后
 * 只被局部重绘时，底部那条会留着"上一帧/底色"的像素（球、药丸都不见了）。
 * `webContents.invalidate()` 是 Electron 给的"整窗重绘"开关，正好治这个。
 * @param win 球窗口
 */
function repaintOrbWindow(win: BrowserWindow): void {
  try {
    if (typeof win.webContents.invalidate === 'function') win.webContents.invalidate();
  } catch {
    /* 重绘失败不影响几何，静默 */
  }
}

/** [XG-CUSTOM] 两个展开方向是否一致（移动后判断要不要换角） */
function sameDirection(a: OrbDirection | undefined, b: OrbDirection | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.horizontal === b.horizontal && a.vertical === b.vertical;
}

/**
 * [XG-CUSTOM] 球原点（从窗口 bounds 反推）。
 * 收起态：窗口就是球外面套了一圈 chrome → 原点 + inset（夹回工作区）。
 * 展开态：窗口是 380×660 的面板，球贴在某个角 → 原点 + 该方向的锚点偏移。
 * 停靠态：窗口是 6×72 的细条 → 原点取"解锁后球会回到哪"（insideBallOrigin），
 * 这样从停靠态展开面板/落盘位置都拿到一个屏内的球原点。
 * @param win 球窗口
 */
function ballOriginFromWindow(win: BrowserWindow): { x: number; y: number } {
  const b = win.getBounds();
  const dock = orbDocked;
  if (dock !== undefined) {
    return insideBallOrigin(dock.side, dock.y, displayForPoint(orbWindowCenter()));
  }
  if (orbMode === 'panel') {
    const anchor = orbBallAnchor();
    return { x: b.x + anchor.x, y: b.y + anchor.y };
  }
  const area = workAreaFor({ x: b.x + ORB_BALL_SIZE / 2, y: b.y + ORB_BALL_SIZE / 2 });
  return clampBall({ x: b.x + ORB_CHROME_INSET, y: b.y + ORB_CHROME_INSET }, area);
}

// ---------------------------------------------------------------------------
// [XG-CUSTOM] X11 SHAPE 塑形（setShape）
//
// 背景：这台机器（Deepin DDE + kwin_x11）合成器起不来（kwinrc 里有 Compositing.LastFailureTimestamp，
// 配合 MESA "Xe KMD experimental" 警告），而**没有合成器时 X11 上不存在真正的透明窗口**：
// 窗口只能拿到 24 位 visual（xwininfo 实测 Depth: 24，无 alpha），页面里"没画"的像素一律不透明黑
// → 收起态看起来就是一个包着球的黑方块。
//
// 唯一的解法（也是 X11 时代的老办法）是 X Shape 扩展把窗口"抠"成目标形状：圆外/圆角外直接**没有窗口**，
// 既不再画黑，鼠标事件也会穿透到桌面。Electron 40 的 `setShape(rects)` 正好暴露了它（@platform win32,linux）。
//
// 注意：塑形会把落在形状外的像素一起裁掉，所以球的柔和外投影（--ball-shadow）没了，
// 渲染进程那边补了内描边（orb.css 的 --ball-ring）保证边缘干净。
// ---------------------------------------------------------------------------

/** setShape 的矩形坐标是不是 DIP（Electron/views 惯例；这台机器缩放 1.5）。
 * 实测若球被裁掉一块 / 形状错位，说明单位是物理像素 → 改成 false（会乘 display.scaleFactor）。 */
const SHAPE_UNIT_IS_DIP = true;
/** 塑形总开关（想回到"黑方块"行为就改 false） */
const SHAPE_ENABLED = true;
/** 水平切片高度（DIP）。1 → 球 70 条、面板角上各 35 条；相邻等宽切片会自动合并，实际矩形很少 */
const SHAPE_SLICE_STEP = 1;
/** 球态：形状圆比页面画的圆（72 DIP）缩进 1 DIP。
 * X11 的 SHAPE 是 1 位掩膜、只能按整数矩形逼近，**形状一旦比画出来的大一点就会露出窗口底色**
 * （这台机器没有合成器 → 露出来就是黑的），所以宁可整体缩进去一点。
 * 1 DIP + smooth 模式的出入 → 形状内最远像素 35.6 < 画的圆半径 36，形状里没有像素是黑的。 */
const BALL_SHAPE_INSET = 1;

type ShapeRect = { x: number; y: number; width: number; height: number };

/**
 * 用水平切片把圆角矩形（radius = min(w,h)/2 时就是圆）逼近成 X Shape 的矩形并集。
 *
 * X11 的 SHAPE 是 1 位掩膜、只能按整数矩形拼，所以切片一定比理想形状略有出入；关键是**别比"页面画出来的"
 * 更大**（这台机器没有合成器，露出来的地方就是黑）。两种模式：
 * - `smooth`：按切片中线取宽度、四舍五入 —— 轮廓最接近真圆，但可能比目标多出 ≤0.5 DIP，
 *   所以调用方要留 1 DIP 的几何余量（球态就是这么做的）。
 * - `tight`：按切片内最靠外的边取宽度、向内取整 —— **严格落在目标形状内**，用来保住面板那条 1px 边线。
 * @param rect 目标区域（窗口坐标系）
 * @param radius 圆角半径
 * @param step 切片高度
 * @param mode 取宽方式（见上）
 * @returns 矩形并集（相邻等宽切片已合并）
 */
function roundedRectShape(
  rect: Rect,
  radius: number,
  step: number,
  mode: 'smooth' | 'tight'
): ShapeRect[] {
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(rect.width, rect.height) / 2)));
  const centerY = rect.height / 2;
  const out: ShapeRect[] = [];
  for (let y = 0; y < rect.height; y += step) {
    const height = Math.min(step, rect.height - y);
    const sample =
      mode === 'smooth'
        ? Math.abs(y + height / 2 - centerY) // 切片中线
        : Math.max(Math.abs(y - centerY), Math.abs(y + height - centerY)); // 切片里离中线最远处
    const arc = Math.max(0, r - (centerY - sample));
    const exact = arc > 0 ? r - Math.sqrt(Math.max(0, r * r - arc * arc)) : 0;
    const inset = mode === 'smooth' ? Math.round(exact) : Math.ceil(exact);
    const width = Math.floor(rect.width - inset * 2);
    if (width < 1) continue; // 极点附近退化掉的切片直接丢掉（形状只会更小，不会露底）
    const x = rect.x + inset;
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      last.x === x &&
      last.width === width &&
      last.y + last.height === rect.y + y
    ) {
      last.height += height; // 等宽切片合并成一整块
      continue;
    }
    out.push({ x, y: rect.y + y, width, height });
  }
  return out;
}

let ballShapeCache: ShapeRect[] | undefined;

/**
 * 球态：96×96 窗口正中抠一个圆。
 * 球在窗口里恒为 inset 12（96-72-12=12，与 expand-* 方向类无关），所以形状坐标是常量。
 * 形状圆半径取 (72-2·BALL_SHAPE_INSET)/2 = 35，比页面画的 72 DIP 圆（半径 36）小 1 DIP，
 * 加上 `smooth` 模式 ≤0.5 DIP 的出入 → 最远点 35.6 < 36（可见直径 ≈ 70 DIP），绝不会露底。
 * 实测 41 条矩形。
 */
function ballShape(): ShapeRect[] {
  const size = ORB_BALL_SIZE - BALL_SHAPE_INSET * 2;
  ballShapeCache ??= roundedRectShape(
    {
      x: ORB_CHROME_INSET + BALL_SHAPE_INSET,
      y: ORB_CHROME_INSET + BALL_SHAPE_INSET,
      width: size,
      height: size,
    },
    size / 2,
    SHAPE_SLICE_STEP,
    'smooth'
  );
  return ballShapeCache;
}

/**
 * 面板态：抠出面板本身（inset 12、圆角 36）的圆角矩形，去掉窗口四角的黑。
 * 用 `tight` 模式让直边与画出来的完全重合（面板那条 1px 描边才不会被裁掉），只把四个圆角收紧 ≤1 DIP。
 * 实测 45 条矩形（中间 564 DIP 高的一大块 + 上下圆角各若干条）。
 *
 * [XG-CUSTOM] 再并上「球那个角」的整圆。球和面板圆角本来就是同一个圆（同心同半径，球是输入药丸的圆帽），
 * 但 `tight` 会把圆角向内收 ≤1 DIP，那一圈**落在球圆内、却不在形状里**。
 * X11 里"形状外"= 没有窗口：像素不画（球自己画满了所以看不出来），但**指针事件也会漏到桌面** ——
 * 真机「展开态点球没反应（拖动也没反应）」的疑似根因就是这个发丝级的输入空洞。
 * 并集只补输入区，可见区域不变（那圈是球自己画的深色）。
 */
function panelShape(): ShapeRect[] {
  const win = orbWindow;
  // [XG-CUSTOM] 宽高取**窗口实际尺寸**（WM 可能偷偷改大）：否则形状比窗口小，超出部分全被裁掉
  // —— 球和输入药丸那条就是这么消失的。球圆锚点同样按实际宽高算。
  const bounds = win !== null && !win.isDestroyed() ? win.getBounds() : undefined;
  const width = bounds?.width ?? PANEL_SIZE.width;
  const height = bounds?.height ?? PANEL_SIZE.height;
  const base = roundedRectShape(
    {
      x: ORB_CHROME_INSET,
      y: ORB_CHROME_INSET,
      width: Math.max(1, width - ORB_CHROME_INSET * 2),
      height: Math.max(1, height - ORB_CHROME_INSET * 2),
    },
    PANEL_RADIUS,
    SHAPE_SLICE_STEP,
    'tight'
  );
  const direction = panelDirection;
  if (direction === undefined) return base;
  const anchor = ballAnchorFor(direction, width, height);
  return [
    ...base,
    ...roundedRectShape(
      { x: anchor.x, y: anchor.y, width: ORB_BALL_SIZE, height: ORB_BALL_SIZE },
      ORB_BALL_SIZE / 2,
      SHAPE_SLICE_STEP,
      'tight'
    ),
  ];
}

/** 按 SHAPE_UNIT_IS_DIP 决定要不要把 DIP 坐标换成物理像素坐标 */
function scaleShape(rects: ShapeRect[], scale: number): ShapeRect[] {
  if (SHAPE_UNIT_IS_DIP || scale === 1) return rects;
  return rects.map((rect) => ({
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  }));
}

/**
 * [XG-CUSTOM] 停靠态：窗口就是那条 6×72 的细条，抠成一个胶囊（radius = 3 = 6/2）。
 * 用 `tight`（严格落在细条内）—— 这台机器没有合成器，形状比画出来的大 1px 就是一条黑边。
 * **停靠态必须重抠**：球态形状是 96×96 里的一个圆，窗口缩成 6×72 之后照旧用球形状的话，
 * 细条整条都在形状之外 → 被 SHAPE 裁掉（屏幕上什么都没有），而且指针事件也漏到桌面。
 */
function dockShape(): ShapeRect[] {
  return roundedRectShape(
    { x: 0, y: 0, width: ORB_DOCK_TAB_WIDTH, height: ORB_DOCK_TAB_HEIGHT },
    ORB_DOCK_TAB_WIDTH / 2,
    SHAPE_SLICE_STEP,
    'tight'
  );
}

/**
 * 给球窗口套上 X11 SHAPE（球态=圆、面板态=圆角矩形、停靠态=6×72 胶囊）。
 * 只有 win32/linux 有 setShape；缺失或抛错就静默退回默认行为（矩形窗口），绝不因此崩。
 * 塑形后形状外的像素不画、鼠标事件也会穿透到桌面。
 * @param mode 当前形态（停靠态也必须重抠：细条在球形状之外，照旧用球形状会被整条裁掉）
 */
function applyOrbShape(mode: OrbVisualMode): void {
  if (!SHAPE_ENABLED) return;
  const win = orbWindow;
  if (!win || win.isDestroyed()) return;
  try {
    if (typeof win.setShape !== 'function') return;
    const scale = SHAPE_UNIT_IS_DIP
      ? 1
      : screen.getDisplayNearestPoint(win.getBounds()).scaleFactor || 1;
    const shape =
      mode === 'docked' ? dockShape() : mode === 'panel' ? panelShape() : ballShape();
    win.setShape(scaleShape(shape, scale));
  } catch {
    /* 塑形失败：保持矩形窗口（就是塑形之前的表现） */
  }
}

/** 跨平台置顶：macOS 用 panel + 所有空间可见；Windows/Linux 用 screen-saver 档（压过其它窗口） */
function presentOverlay(win: BrowserWindow): void {
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    return;
  }
  win.setAlwaysOnTop(true, 'screen-saver');
}

function notifyMode(): void {
  // [XG-CUSTOM] 除了"态"和 pin，还把**展开方向**带过去：移动会让方向变（球跑到屏幕另一半），
  // 渲染进程必须跟着换 expand-* 类，否则页面画的球和主进程形状里的球圆不在同一个角。
  // 第四个参数是**停靠侧**（'left' | 'right' | null）：渲染进程靠它切 body.docked-* + 点亮 #dock-tab。
  orbWindow?.webContents.send(
    'xiangwo:orb-mode',
    orbMode === 'panel' ? 'panel' : 'ball',
    pinned,
    orbMode === 'panel' ? panelDirection ?? null : null,
    orbDocked?.side ?? null
  );
}

/**
 * 切换球/面板两态：设置窗口 bounds 并通知渲染进程。
 * [XG-CUSTOM] 展开会**清掉停靠**（照上游 setFloatingExpanded：展开态不吸边）；
 * 从停靠态展开时，球原点是"解锁后球会回到哪"（见 ballOriginFromWindow），不会跳到屏幕外。
 * @param mode 目标态
 * @returns 展开方向（收起时渲染进程忽略；`floating.setExpanded` 会把它回给 orb.js）
 */
function applyMode(mode: OrbMode): OrbDirection {
  const win = orbWindow;
  if (!win || win.isDestroyed()) {
    return { horizontal: 'left', vertical: 'down' };
  }
  // [XG-CUSTOM] 球原点以**窗口当前实际位置**为准，不再读磁盘：
  // 窗口可能被拖过却没落盘（拖动中途被取消/异常退出/被 WM 挪动），或磁盘值来自更早的会话；
  // 用过期的球原点展开，球会在屏幕上"跳"一下 —— 用户按老位置点球就点空了（真机反馈过）。
  // 磁盘值（readSavedState）只在建窗时用一次，收起时会把实际位置写回去。
  const ball = ballOriginFromWindow(win);
  const area = workAreaFor({ x: ball.x, y: ball.y });
  const direction = orbDirection(ball, area);
  orbMode = mode;
  if (mode === 'panel' && orbDocked !== undefined) {
    // 展开态不吸边：清停靠（也打断在跑的吸边/滑回动画）
    orbDocked = undefined;
    orbDockToken += 1;
    cancelOrbAnim();
  }
  const target = mode === 'panel' ? expandedBounds(ball, area, direction) : collapsedBounds(ball);
  panelDirection = mode === 'panel' ? direction : undefined;
  setOrbBounds(win, target, `applyMode:${mode}`);
  // [XG-CUSTOM] resize 可能让 X11 丢/留错 shape，所以每次切态都在 setBounds 之后重新塑形
  applyOrbShape(mode);
  // [XG-CUSTOM] 改尺寸后强制整窗重绘（否则底部那条可能留旧像素：球/药丸看不见）
  repaintOrbWindow(win);
  if (mode === 'ball') saveOrbState({ ball });
  notifyMode();
  orbTrace('main-applyMode', {
    mode,
    ball,
    direction,
    target,
    ballAnchor: mode === 'panel' ? orbBallAnchor() : null,
    shapeRects: mode === 'panel' ? panelShape().length : ballShape().length,
  });
  return direction;
}

/**
 * 把球原点移到 (x, y)，球窗口跟着走。渲染进程自绘拖动每帧调这个。
 *
 * [XG-CUSTOM] 按当前模式分两条（两条都不改 orbMode）：
 * - `ball`（收起态）：维持原行为 —— 窗口就是球外面那圈 chrome，直接 setBounds(collapsedBounds)。
 * - `panel`（展开态）：球是输入药丸的圆帽，拖它要**平移整个面板** —— 尺寸不变、不收起、不改 orbMode、
 *   不重新塑形也不 notifyMode。传进来的 (x, y) 是「球的左上角目标」（渲染进程按 pointerdown 的抓取
 *   偏移算的），减去球在窗口内的锚点 = 窗口原点，再把面板整体夹回工作区（面板跑不出屏幕）。
 * @param x 目标球原点 x（屏幕 DIP）
 * @param y 目标球原点 y（屏幕 DIP）
 * @returns 球实际落点（panel 态被夹到工作区边缘时与请求值不同）
 */
function moveOrbBall(x: number, y: number): OrbBallPoint | undefined {
  const win = orbWindow;
  if (!win || win.isDestroyed()) return undefined;
  const requested = { x: Math.round(x), y: Math.round(y) };
  if (orbMode === 'panel') {
    const bounds = win.getBounds();
    const area = workAreaFor(requested);
    let anchor = orbBallAnchor();
    let originX = clamp(requested.x - anchor.x, area.x, area.x + area.width - bounds.width);
    let originY = clamp(requested.y - anchor.y, area.y, area.y + area.height - bounds.height);
    setOrbBounds(
      win,
      {
        x: Math.round(originX),
        y: Math.round(originY),
        width: bounds.width,
        height: bounds.height,
      },
      'moveOrbBall:panel'
    );
    let ball = { x: Math.round(originX + anchor.x), y: Math.round(originY + anchor.y) };

    // [XG-CUSTOM] **移动后重算展开方向**：球可能已经跑到屏幕另一半 → 面板该改往另一边长
    // （否则往左拖到头就卡住，面板也没法再往里放）。方向变了就换锚点、把窗口重新锚到球的
    // 新一侧（球的屏幕位置不动），再重抠形状；并通知渲染进程换 expand-* 类（否则
    // "页面按新方向画球、主进程形状还停在旧角"会错位 —— 用户实测"移动后球消失"的疑似来源）。
    const nextDirection = orbDirection(ball, workAreaFor(ball));
    const directionChanged = !sameDirection(nextDirection, panelDirection);
    if (directionChanged) {
      panelDirection = nextDirection;
      anchor = orbBallAnchor();
      originX = clamp(ball.x - anchor.x, area.x, area.x + area.width - bounds.width);
      originY = clamp(ball.y - anchor.y, area.y, area.y + area.height - bounds.height);
      setOrbBounds(
        win,
        {
          x: Math.round(originX),
          y: Math.round(originY),
          width: bounds.width,
          height: bounds.height,
        },
        'moveOrbBall:panel:reanchor'
      );
      ball = { x: Math.round(originX + anchor.x), y: Math.round(originY + anchor.y) };
    }
    // 球圆在形状里的位置（可能）变了 → 每次移动都重抠一遍（矩形集很小，成本可以忽略）
    applyOrbShape('panel');
    // [XG-CUSTOM] 移动后强制整窗重绘：真机"球/药丸整条消失"就是这么治的
    repaintOrbWindow(win);
    if (directionChanged) notifyMode();
    orbTrace('main-moveBall', {
      mode: 'panel',
      requested,
      anchor,
      landed: ball,
      size: bounds,
      direction: panelDirection ?? null,
      directionChanged,
    });
    return ball;
  }
  // [XG-CUSTOM] 收起态：**故意不夹回工作区** —— 边缘停靠要求球在松手前能压住屏幕边
  // （压住 ≥ ORB_DOCK_OVERLAP 才吸边，见 dockSideForBallOrigin）。真正的收尾在松手时：
  // orb-drag-end → clampOrbBall()（吸边 或 夹回工作区），所以球不会丢在屏幕外。
  const ball = requested;
  // 停靠态下被拖动 = 解锁（不会出现"细条跟着球跑"的错位）
  if (orbDocked !== undefined) {
    orbDocked = undefined;
    orbDockToken += 1;
    cancelOrbAnim();
  }
  setOrbBounds(win, collapsedBounds(ball), 'moveOrbBall:ball');
  // 收起态形状是常量（球恒在 (12,12)），但移动后重抠一次更保险（X11 上移动偶发丢 shape）
  applyOrbShape('ball');
  repaintOrbWindow(win);
  orbTrace('main-moveBall', { mode: 'ball', requested, landed: ball });
  return ball;
}

/**
 * [XG-CUSTOM] 松手/夹回：球贴住屏幕左/右边缘（压住 ≥ ORB_DOCK_OVERLAP）就**吸边**成 6px 细条，
 * 否则把球夹回工作区。停靠态下再夹 = 重新对齐细条（保持停靠）。
 *
 * `canDock = false`（正在跑会话 / 提问卡待答）时**绝不进入**停靠；如果本来停靠着，这里会直接解锁
 * （上游只保证"不进入"，我们多做一步：运行中不许**保持**停靠，否则细条就没人管了）。
 * @param canDock 是否允许停靠（渲染进程的 running/asking + 主进程的 running 护栏，见 dockAllowed）
 * @returns 落点 + 停靠侧（docked 要透传给渲染进程）
 */
async function clampOrbBall(canDock = true): Promise<OrbBallOutcome> {
  const win = orbWindow;
  if (!win || win.isDestroyed()) return { docked: null };
  // [XG-CUSTOM] 展开态夹的是"整个面板"：只平移、尺寸不变（绝不能 setBounds(collapsedBounds) 缩回球态）
  if (orbMode === 'panel') {
    const ball = moveOrbBall(ballOriginFromWindow(win).x, ballOriginFromWindow(win).y);
    return { ball, docked: null };
  }
  if (orbDocked !== undefined) {
    if (!canDock) return unsnapDockedBall();
    const dock = orbDocked;
    const bounds = displayForPoint(orbWindowCenter()).bounds;
    applyDockedTab(win, dock.side, dock.y, bounds);
    notifyMode();
    return { ball: ballOriginFromWindow(win), docked: dock.side };
  }
  const current = win.getBounds();
  const display = displayForPoint({
    x: current.x + ORB_BALL_SIZE / 2,
    y: current.y + ORB_BALL_SIZE / 2,
  });
  const origin = { x: current.x + ORB_CHROME_INSET, y: current.y + ORB_CHROME_INSET };
  if (canDock) {
    const side = dockSideForBallOrigin(origin, display.bounds);
    if (side !== undefined) {
      const docked = await snapToEdge(side, origin.y, display.bounds);
      notifyMode();
      return { ball: ballOriginFromWindow(win), docked: docked ?? null };
    }
  }
  const ball = clampBall(origin, display.workArea);
  setOrbBounds(win, collapsedBounds(ball), 'clampOrbBall:ball');
  // [XG-CUSTOM] 夹回也可能改尺寸（从 WM 缩放态的 96×96 变回 96×96 是同一个，但形状会被 X11 丢）
  applyOrbShape('ball');
  repaintOrbWindow(win);
  saveOrbState({ ball });
  orbTrace('main-clampBall', { ball, requested: origin, canDock });
  return { ball, docked: null };
}

export function getOrbWindow(): BrowserWindow | null {
  return orbWindow;
}

export function setOrbOpenMainHandler(handler: () => void): void {
  openMainHandler = handler;
}

function registerOrbIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle('xiangwo:orb-expand', () => {
    applyMode('panel');
    return true;
  });
  ipcMain.handle('xiangwo:orb-collapse', () => {
    if (!pinned) applyMode('ball');
    return pinned;
  });
  ipcMain.handle('xiangwo:orb-toggle-pin', () => {
    pinned = !pinned;
    notifyMode();
    return pinned;
  });
  // 渲染进程拖球：传绝对屏幕坐标（screenX/screenY 减按下时的偏移）。
  // [XG-CUSTOM] 保留通道（XiangwoFloatingPanel 还引用），但球窗口现在走 CSS 原生拖动；
  // orb.js 不再调用这两个方法。
  ipcMain.handle('xiangwo:orb-drag', (_e, x: number, y: number) => {
    if (!orbWindow || orbWindow.isDestroyed()) return false;
    moveOrbBall(x, y);
    return true;
  });
  // [XG-CUSTOM] 松手 = 提交停靠：球压住屏幕左/右边缘就吸边，否则夹回工作区。
  // 返回值带 `docked`（'left' | 'right' | null）—— orb.js 靠它切 body.docked-* + 点亮 #dock-tab。
  // 第二个参数是渲染进程算的 canDock（!(running || 提问卡待答)）；主进程再用 running 护栏兜一层。
  ipcMain.handle('xiangwo:orb-drag-end', async (_e, canDock?: unknown) => {
    const win = orbWindow;
    if (!win || win.isDestroyed()) return { ok: false, docked: null };
    const outcome = await clampOrbBall(dockAllowed(canDock));
    orbTrace('main-dragEnd', {
      mode: visualMode(),
      ball: outcome.ball ?? ballOriginFromWindow(win),
      docked: outcome.docked,
      bounds: win.getBounds(),
    });
    return { ok: true, docked: outcome.docked };
  });
  ipcMain.handle('xiangwo:orb-open-main', () => {
    orbTrace('main-open-main');
    openMainHandler?.();
    return true;
  });
  ipcMain.handle('xiangwo:orb-quit', () => {
    app.quit();
    return true;
  });
  // [XG-CUSTOM] 第四个元素是停靠侧（渲染进程启动时用它恢复 body.docked-* / #dock-tab）
  ipcMain.handle('xiangwo:orb-mode', () => [
    orbMode,
    pinned,
    orbMode === 'panel' ? panelDirection ?? null : null,
    orbDocked?.side ?? null,
  ]);
  // [XG-CUSTOM] orb.js 的宿主 API：把 Orb 的 rpc('floating.*') 全接到这里（路由见 xiangwo-orb-api.ts）
  registerXiangwoOrbApi({
    applyMode,
    moveBall: (x, y) => ({ ball: moveOrbBall(x, y), docked: orbDocked?.side ?? null }),
    clampBall: (canDock) => clampOrbBall(dockAllowed(canDock)),
    unsnapBall: () => unsnapDockedBall(),
    getWindow: getOrbWindow,
  });
}

/**
 * 创建（或复用）项我控制球窗口。
 * @param openMain 右键/面板里「打开主窗口」要做的事
 */
export function createXiangwoOrbWindow(openMain: () => void): BrowserWindow {
  setOrbOpenMainHandler(openMain);
  registerOrbIpc();
  if (orbWindow && !orbWindow.isDestroyed()) {
    orbWindow.show();
    orbWindow.focus();
    return orbWindow;
  }
  // [XG-CUSTOM] 位置记忆：`ball`（球原点）+ `dock`（停靠侧）。停靠态也一并恢复 ——
  // 重启后细条还贴在原来那条屏幕边上、同一个高度，不会先冒出一颗球再"跳"回去。
  const saved = readSavedState();
  const savedBall = saved.ball;
  const initialArea = workAreaFor(savedBall ?? { x: 0, y: 0 });
  const ball = savedBall ?? defaultBallOrigin(screen.getPrimaryDisplay().workArea);
  const initialBall = clampBall(ball, initialArea);
  const savedDock = saved.dock;
  const dockBounds =
    savedDock === undefined
      ? undefined
      : dockedTabBounds(
          savedDock.side,
          savedDock.y,
          screenBoundsFor({ x: initialBall.x + ORB_BALL_SIZE / 2, y: initialBall.y + ORB_BALL_SIZE / 2 })
        );
  orbDocked = savedDock === undefined || dockBounds === undefined ? undefined : { ...savedDock, y: dockBounds.y };
  const bounds = dockBounds ?? collapsedBounds(initialBall);

  orbWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    // [XG-CUSTOM] 显式给全透明底色：Linux/X11 上透明窗偶发用默认底色（看起来是一整块深色方块），
    // 页面里 html/body 也是 transparent，两者一起保证窗口里只有球。
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false, // 无边框下圆角会留一条"隐藏标题栏"，点它会激活整个 app
    title: '项我球',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      // 渲染进程靠这两个 argv 标志判断"我是浮窗/我是球"
      additionalArguments: ['--xiangwo-floating', '--xiangwo-orb'],
      preload: join(app.getAppPath(), 'out', 'preload', 'index.mjs'),
    },
  });
  presentOverlay(orbWindow);
  // [XG-CUSTOM] 再显式压一次全透明底色（构造参数在部分平台会被默认底色覆盖）
  orbWindow.setBackgroundColor('#00000000');
  if (process.platform !== 'darwin') orbWindow.setMenuBarVisibility(false);
  // [XG-CUSTOM] 建窗即塑形（这台机器没有合成器，透明无效 → 只能靠 X Shape 抠出来）：
  // 恢复成停靠态就抠 6×72 胶囊，否则抠圆。
  applyOrbShape(visualMode());

  // [XG-CUSTOM] 加载移植过来的 Orb 页面（同一颗球窗口，不新建窗口）：
  // DEV = vite dev server 的 /orb/orb.html；生产 = app://<app>/orb/orb.html（out/renderer/orb/orb.html）
  const query = '?xiangwo-floating=1&xiangwo-orb=1';
  if (import.meta.env.DEV) {
    void orbWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL!}/orb/orb.html${query}`);
  } else {
    void orbWindow.loadURL(`${APP_ORIGIN}/orb/orb.html${query}`);
  }
  orbWindow.once('ready-to-show', () => {
    // [XG-CUSTOM] 第一次真正上屏前再塑一次（某些平台是 map 之后才认 shape）
    applyOrbShape(visualMode());
    orbWindow?.show();
  });
  // [XG-CUSTOM] resize（展开/收起/夹回）后 X11 的 shape 可能失效或与尺寸不匹配 → 重新塑形。
  // 自绘拖动只 move 不改尺寸，所以不会在这里被高频触发。
  //
  // [XG-CUSTOM] resize 双重职责：
  //   ① 重新塑形（X11 上 resize 会让 shape 失效/错位）；
  //   ② **缩放护栏**：`resizable:false` 挡不住 WM 级缩放（DDE/KWin 的 Super+拖动缩放、
  //      窗口规则都能改 bounds）。实测真机窗口曾被放到 677×884 DIP —— CSS 的球锚点是相对
  //      实际窗口算的，而 SHAPE 若还是 380×660，球和输入药丸那条就整片被裁掉。
  //      所以只要尺寸不等于该模式应有的尺寸，就立刻拉回去（applyingBounds 只用于区分同步调用）。
  orbWindow.on('resize', () => {
    const win = orbWindow;
    if (!win || win.isDestroyed()) return;
    const mode = visualMode();
    applyOrbShape(mode);
    const want = sizeForMode(mode);
    const current = win.getBounds();
    if (current.width === want.width && current.height === want.height) return;
    if (applyingBounds) return;
    setOrbBounds(win, { ...current, width: want.width, height: want.height }, 'resize-guard');
    applyOrbShape(mode);
    repaintOrbWindow(win);
    orbTrace('main-resize-guard', {
      mode,
      from: [current.width, current.height],
      to: [want.width, want.height],
    });
  });
  // [XG-CUSTOM] 不用 win.on('move'/'moved') 记位置：球现在是自绘指针拖动（orb.js），
  // 位置由渲染进程 orbDrag/orbDragEnd 驱动，收尾时已经会 saveOrbState（球态或停靠态）。
  orbWindow.webContents.on('did-finish-load', () => {
    notifyMode();
    orbWindow?.webContents
      .executeJavaScript("document.getElementById('boot-splash')?.remove();")
      .catch(() => {});
  });
  orbWindow.on('closed', () => {
    orbWindow = null;
    orbDocked = undefined;
    cancelOrbAnim();
  });
  orbMode = 'ball';
  return orbWindow;
}
