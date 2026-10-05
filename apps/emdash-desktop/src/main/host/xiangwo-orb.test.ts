// [XG-CUSTOM] 项我球「边缘停靠（dock）」主进程侧单测。
//
// 假 electron（照本仓库既有做法，见 ./tray.test.ts）：
//   - BrowserWindow 用记录 bounds / setShape / webContents.send 的假类，并在**尺寸变化时异步发 resize**
//     （真的 Electron 就是这么做的）—— 这样 xiangwo-orb.ts 里的"缩放护栏"会被真实触发，
//     能抓到"护栏把停靠细条又拉回 96×96"这类回归。
//   - ipcMain.handle 把注册的处理器收进一张表，测试直接当 IPC 调（就跟渲染进程调的一样）。
//   - screen.getDisplayNearestPoint 按点选屏（含一块第二显示器，验多屏停靠目标屏）。
//   - app.getPath('userData') 指向每个用例独立的临时目录（验位置记忆落盘/恢复）。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
type Rect = { x: number; y: number; width: number; height: number };
type ShapeRect = { x: number; y: number; width: number; height: number };
type Display = { bounds: Rect; workArea: Rect; scaleFactor: number };

const state = vi.hoisted(() => {
  const userData = { dir: '' };
  const displays: Display[] = [];
  const handlers = new Map<string, (...args: never[]) => unknown>();
  // [XG-CUSTOM 2026-10-05] screen.on/removeListener 的假实现 + 触发入口（测「显示器变化重夹」）
  const screenListeners = new Map<string, ((...args: never[]) => void)[]>();
  const screenEmit = (event: string): void => {
    for (const fn of screenListeners.get(event) ?? []) fn();
  };
  return { userData, displays, handlers, screenListeners, screenEmit };
});

const PRIMARY: Display = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const SECONDARY: Display = {
  bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
  workArea: { x: 1920, y: 0, width: 1280, height: 1000 },
  scaleFactor: 1,
};

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];
  /** true = 模拟 KWin：把越界窗口拉回屏内（见 setBounds） */
  static wmClampOffScreen = false;
  static screenBounds: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

  bounds: Rect;
  destroyed = false;
  shapes: ShapeRect[][] = [];
  sent: unknown[][] = [];
  shown = false;
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  webContents = {
    send: (...args: unknown[]) => {
      this.sent.push(args);
    },
    on: (event: string, fn: (...args: never[]) => void) => this.on(event, fn),
    executeJavaScript: () => Promise.resolve(undefined),
    invalidate: () => {},
  };

  constructor(options: Partial<Rect>) {
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 0,
      height: options.height ?? 0,
    };
    FakeBrowserWindow.instances.push(this);
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  setBounds(next: Partial<Rect>): void {
    const previous = this.bounds;
    this.bounds = {
      x: Math.round(next.x ?? previous.x),
      y: Math.round(next.y ?? previous.y),
      width: Math.round(next.width ?? previous.width),
      height: Math.round(next.height ?? previous.height),
    };
    // [XG-CUSTOM] 模拟真机 WM（KWin/X11）：**不许窗口停在屏幕外**。
    // 真机探针实测（2026-10-01）：setBounds({x:-48}) 之后 50~150ms 内被拉回 x:0，
    // setBounds(右沿+30) 被拉回 右沿-96 —— 这就是"拖到屏幕边却吸不上边"的根因。
    // 打开这个开关跑用例 = 复现真机；停靠判定必须用拖动目标、不能读回窗口位置。
    if (FakeBrowserWindow.wmClampOffScreen) {
      const screen = FakeBrowserWindow.screenBounds;
      this.bounds.x = Math.min(
        Math.max(this.bounds.x, screen.x),
        screen.x + screen.width - this.bounds.width
      );
      this.bounds.y = Math.min(
        Math.max(this.bounds.y, screen.y),
        screen.y + screen.height - this.bounds.height
      );
    }
    // 真 Electron：尺寸变了才发 resize（异步）
    if (previous.width !== this.bounds.width || previous.height !== this.bounds.height) {
      setTimeout(() => this.emit('resize'), 0);
    }
  }

  setShape(rects: ShapeRect[]): void {
    this.shapes.push(rects.map((rect) => ({ ...rect })));
  }

  lastShape(): ShapeRect[] {
    return this.shapes[this.shapes.length - 1] ?? [];
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  on(event: string, fn: (...args: never[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  once(event: string, fn: (...args: never[]) => void): void {
    this.on(event, fn);
  }

  emit(event: string): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  show(): void {
    this.shown = true;
    this.emit('ready-to-show');
  }

  focus(): void {}
  setAlwaysOnTop(): void {}
  setBackgroundColor(): void {}
  setMenuBarVisibility(): void {}
  setVisibleOnAllWorkspaces(): void {}
  // [XG-CUSTOM 2026-10-05] 球在 win32/darwin 上会开内容保护（屏幕捕获排除自己）；
  // 真 Electron 一定有这个方法，假窗口补个 no-op。
  setContentProtection(): void {}
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): void {
    this.destroyed = true;
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData.dir,
    getAppPath: () => state.userData.dir,
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
  screen: {
    getPrimaryDisplay: () => state.displays[0],
    getDisplayNearestPoint: (point: { x: number; y: number }) => {
      const hit = state.displays.find(
        (display) =>
          point.x >= display.bounds.x &&
          point.x < display.bounds.x + display.bounds.width &&
          point.y >= display.bounds.y &&
          point.y < display.bounds.y + display.bounds.height
      );
      return hit ?? state.displays[0];
    },
    // [XG-CUSTOM 2026-10-05] 真实 Electron 的 screen 一定有 on/removeListener；
    // 之前 mock 没给 → 新加的多屏监听一注册就炸（28 个用例全挂），所以补上。
    on: (event: string, fn: (...args: never[]) => void): void => {
      const list = state.screenListeners.get(event) ?? [];
      list.push(fn);
      state.screenListeners.set(event, list);
    },
    removeListener: (event: string, fn: (...args: never[]) => void): void => {
      state.screenListeners.set(
        event,
        (state.screenListeners.get(event) ?? []).filter((listener) => listener !== fn)
      );
    },
  },
  BrowserWindow: FakeBrowserWindow,
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  shell: { openExternal: vi.fn() },
}));

vi.mock('./protocol', () => ({ APP_ORIGIN: 'app://emdash-test' }));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// [XG-CUSTOM] 建窗走的就是 vite dev server 那条路（DEV=true）→ 给它一个假地址（假窗口的 loadURL 是 no-op）
vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173');

const {
  ORB_BALL_SIZE,
  ORB_DOCK_OVERLAP,
  ORB_DOCK_TAB_WIDTH,
  ORB_DOCK_TAB_HEIGHT,
  dockSideForBallOrigin,
} = await import('./xiangwo-orb');

/** 当渲染进程那样调一次 IPC（第一个参数是 IpcMainInvokeEvent，真机由 Electron 传） */
function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel);
  if (handler === undefined) throw new Error(`no ipc handler for ${channel}`);
  return Promise.resolve((handler as (...a: unknown[]) => T)({}, ...args));
}

/** 等一轮宏任务 + 假窗口排队的 resize（护栏是异步跑的） */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 12));
}

function savedFile(): { ball?: { x: number; y: number }; dock?: { side: string; y: number } } {
  return JSON.parse(readFileSync(join(state.userData.dir, 'xiangwo-orb.json'), 'utf8')) as {
    ball?: { x: number; y: number };
    dock?: { side: string; y: number };
  };
}

function orb(): FakeBrowserWindow {
  const live = FakeBrowserWindow.instances.filter((win) => !win.destroyed);
  return live[live.length - 1];
}

/** 拖到 (x, y) 然后松手，返回主进程给的停靠结论（docked + dockRefused） */
async function dragTo(
  x: number,
  y: number,
  canDock = true
): Promise<{ ok: boolean; docked: string | null; dockRefused: boolean }> {
  await call('xiangwo:orb-drag', x, y);
  const result = await call<{ ok: boolean; docked: string | null; dockRefused: boolean }>(
    'xiangwo:orb-drag-end',
    canDock
  );
  await settle();
  return result;
}

beforeEach(async () => {
  state.userData.dir = mkdtempSync(join(tmpdir(), 'xiangwo-orb-test-'));
  state.displays.length = 0;
  state.displays.push(PRIMARY);
  // 每个用例都用全新的模块实例（模块级 orbDocked / 窗口引用 / IPC 注册表都要重来）
  vi.resetModules();
  state.handlers.clear();
  state.screenListeners.clear();
  FakeBrowserWindow.instances.length = 0;
  FakeBrowserWindow.wmClampOffScreen = false;
  FakeBrowserWindow.screenBounds = { ...PRIMARY.bounds };
  const mod = await import('./xiangwo-orb');
  mod.createXiangwoOrbWindow(() => {});
  await settle();
});

afterEach(() => {
  rmSync(state.userData.dir, { recursive: true, force: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('xiangwo orb 边缘停靠（主进程）', () => {
  describe('dockSideForBallOrigin（阈值边界，几何纯函数）', () => {
    const bounds: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

    it('压住右边缘不足球宽 1/5 不吸边', () => {
      expect(
        dockSideForBallOrigin({ x: 1920 - ORB_BALL_SIZE + ORB_DOCK_OVERLAP - 1, y: 100 }, bounds)
      ).toBe(undefined);
    });

    it('刚好压住球宽 1/5 就吸边', () => {
      expect(
        dockSideForBallOrigin({ x: 1920 - ORB_BALL_SIZE + ORB_DOCK_OVERLAP, y: 100 }, bounds)
      ).toBe('right');
    });

    it('左边缘同理（对称）', () => {
      expect(dockSideForBallOrigin({ x: -ORB_DOCK_OVERLAP + 1, y: 100 }, bounds)).toBe(undefined);
      expect(dockSideForBallOrigin({ x: -ORB_DOCK_OVERLAP, y: 100 }, bounds)).toBe('left');
    });

    it('上下边永不吸边（只看左右）', () => {
      expect(dockSideForBallOrigin({ x: 900, y: 1080 - 20 }, bounds)).toBe(undefined);
      expect(dockSideForBallOrigin({ x: 900, y: -20 }, bounds)).toBe(undefined);
    });
  });

  describe('吸边（右边缘）', () => {
    it('球滑出屏幕，只留 6px 细条，并把停靠侧回给渲染进程', async () => {
      const result = await dragTo(1920 - ORB_BALL_SIZE + 20, 300);

      expect(result).toMatchObject({ ok: true, docked: 'right' });
      const bounds = orb().getBounds();
      expect(bounds.width).toBe(ORB_DOCK_TAB_WIDTH);
      expect(bounds.height).toBe(ORB_DOCK_TAB_HEIGHT);
      // x 让细条**恰好**留在屏幕内 6px：窗口右沿 = 屏幕右沿
      expect(bounds.x + bounds.width).toBe(PRIMARY.bounds.x + PRIMARY.bounds.width);
      expect(bounds.x).toBe(1920 - ORB_DOCK_TAB_WIDTH);
      expect(bounds.y).toBe(300);
    });

    it('吸边动画结束后窗口停在细条上（250ms easeInOutCubic 的终点）', async () => {
      // 动画在 drag-end 的 await 里跑完，这里确认中途没有留下 96×96 的球窗口
      await dragTo(1920 - ORB_BALL_SIZE + 30, 420);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const bounds = orb().getBounds();
      expect([bounds.width, bounds.height]).toEqual([ORB_DOCK_TAB_WIDTH, ORB_DOCK_TAB_HEIGHT]);
    });

    it('停靠态重新抠形（X11 SHAPE）：形状恒在 6×72 窗口内，不会露黑', async () => {
      const win = orb();
      const before = win.shapes.length;
      await dragTo(1920 - ORB_BALL_SIZE + 20, 300);

      const shape = win.lastShape();
      expect(win.shapes.length).toBeGreaterThan(before);
      expect(shape.length).toBeGreaterThan(0);
      // 形状必须严格落在细条窗口里（形状比窗口大 → 没有合成器时就是黑边）
      for (const rect of shape) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(ORB_DOCK_TAB_WIDTH);
        expect(rect.y + rect.height).toBeLessThanOrEqual(ORB_DOCK_TAB_HEIGHT);
      }
      // 中间那几行应该是满宽 6px（胶囊的中段）
      const mid = shape.find((rect) => rect.y < 36 && rect.y + rect.height > 36);
      expect(mid?.width).toBe(ORB_DOCK_TAB_WIDTH);
    });

    it('细条的 y 夹进屏幕（拖到屏幕上方/下方也不会跑出去）', async () => {
      await dragTo(1920 - ORB_BALL_SIZE + 20, -500);
      expect(orb().getBounds().y).toBe(0);
    });
  });

  describe('吸边（左边缘）', () => {
    it('窗口 x = 屏幕左沿，球滑出屏幕外', async () => {
      const result = await dragTo(-20, 240);
      expect(result.docked).toBe('left');
      const bounds = orb().getBounds();
      expect(bounds.width).toBe(ORB_DOCK_TAB_WIDTH);
      expect(bounds.x).toBe(PRIMARY.bounds.x);
      expect(bounds.y).toBe(240);
    });
  });

  // ==========================================================================
  // 真机复现回归（2026-10-01：「拖到屏幕左沿停靠触发不了」）
  // 根因一：KWin 不允许窗口停在屏幕外 → setBounds(-48) 被拉回 0 → 读回窗口位置
  //         算出的 overlap 恒为负 → 永远吸不上边。修法：判定用**拖动目标**。
  // 根因二：当时球里有一个挂着的请求（running=true）→ canDock=false → 静默拒绝。
  //         修法：显式回报 dockRefused（渲染进程给红环反馈）+ 建窗时清掉残留的 running。
  // ==========================================================================
  describe('真机回归：拖到屏幕左沿越界（要求 2 的两条断言）', () => {
    it('球目标 x = 屏左沿 − 60 → 吸边（细条 6×72、docked:left）', async () => {
      const left = PRIMARY.bounds.x;
      const result = await dragTo(left - 60, 300);

      expect(result.docked).toBe('left');
      const bounds = orb().getBounds();
      expect([bounds.width, bounds.height]).toEqual([ORB_DOCK_TAB_WIDTH, ORB_DOCK_TAB_HEIGHT]);
      expect(bounds.x).toBe(left);
      expect(savedFile().dock).toEqual({ side: 'left', y: 300 });
    });

    it('球目标 x = 屏左沿 − 13（不到球宽 1/5）→ 不吸边、夹回工作区', async () => {
      const result = await dragTo(PRIMARY.bounds.x - ORB_DOCK_OVERLAP + 1, 300);

      expect(result.docked).toBeNull();
      const bounds = orb().getBounds();
      expect(bounds.width).toBe(96);
      // 球被夹回工作区左沿（球原点 = 0），窗口 = 球 - chrome inset
      expect(bounds.x).toBe(PRIMARY.workArea.x - 12);
      expect(savedFile().dock).toBeUndefined();
    });

    it('★ WM 把越界窗口拉回屏内（KWin 真机行为）也照样吸边', async () => {
      // 打开模拟：任何越界的 setBounds 都会被拉回屏内 → getBounds() 永远"没越界"
      FakeBrowserWindow.wmClampOffScreen = true;
      const left = PRIMARY.bounds.x;
      const result = await dragTo(left - 60, 300);

      // 窗口位置读回来是 x=0（被 WM 拉了），但判定用的是拖动目标 -60 → 仍然吸边
      expect(result.docked).toBe('left');
      const bounds = orb().getBounds();
      expect([bounds.width, bounds.height]).toEqual([ORB_DOCK_TAB_WIDTH, ORB_DOCK_TAB_HEIGHT]);
      expect(bounds.x).toBe(left);
      expect(savedFile().dock).toMatchObject({ side: 'left' });
    });

    it('★ WM 拉回屏内时，越界 13（不够阈值）依然不吸边', async () => {
      FakeBrowserWindow.wmClampOffScreen = true;
      const result = await dragTo(PRIMARY.bounds.x - ORB_DOCK_OVERLAP + 1, 300);
      expect(result.docked).toBeNull();
      expect(orb().getBounds().width).toBe(96);
    });

    it('没有拖动过程（直接 clamp）时退回"窗口位置"判定，不会凭空吸边', async () => {
      // 球停在屏内（默认位），直接 floating.clamp：
      const clamped = await call<{ docked: string | null }>(
        'xiangwo:orb-api',
        'floating.clamp',
        {}
      );
      expect(clamped.docked).toBeNull();
      expect(orb().getBounds().width).toBe(96);
    });
  });

  describe('运行时拒绝停靠要"说得出为什么"（要求：不能静默）', () => {
    it('running=true 时拖到边缘：docked:null 且 dockRefused:true', async () => {
      writeFileSync(
        join(state.userData.dir, 'xiangwo-orb-session.json'),
        `${JSON.stringify({ running: true })}\n`,
        'utf8'
      );
      const result = await dragTo(PRIMARY.bounds.x - 60, 300);
      expect(result.docked).toBeNull();
      expect(result.dockRefused).toBe(true);
    });

    it('渲染进程说 canDock=false 也回报 dockRefused（提问卡待答那条路）', async () => {
      const result = await dragTo(PRIMARY.bounds.x - 60, 300, false);
      expect(result.docked).toBeNull();
      expect(result.dockRefused).toBe(true);
    });

    it('球停在屏内时 clamp 不会被误报成 dockRefused', async () => {
      const result = await dragTo(800, 400);
      expect(result.docked).toBeNull();
      expect(result.dockRefused).toBe(false);
    });

    it('建窗时清掉残留的 running（否则停靠会永久失效）', async () => {
      writeFileSync(
        join(state.userData.dir, 'xiangwo-orb-session.json'),
        `${JSON.stringify({ sessionId: 's1', running: true })}\n`,
        'utf8'
      );
      vi.resetModules();
      state.handlers.clear();
      FakeBrowserWindow.instances.length = 0;
      const restarted = await import('./xiangwo-orb');
      restarted.createXiangwoOrbWindow(() => {});
      await settle();

      const session = JSON.parse(
        readFileSync(join(state.userData.dir, 'xiangwo-orb-session.json'), 'utf8')
      ) as { running?: boolean; sessionId?: string };
      expect(session.running).toBe(false);
      expect(session.sessionId).toBe('s1'); // 会话 id 不能丢

      const result = await dragTo(PRIMARY.bounds.x - 60, 300);
      expect(result.docked).toBe('left');
    });
  });

  describe('位置记忆（xiangwo-orb.json）', () => {
    it('停靠侧落盘（兼容旧 ball 字段）', async () => {
      await dragTo(1920 - ORB_BALL_SIZE + 20, 512);
      const saved = savedFile();
      expect(saved.dock).toEqual({ side: 'right', y: 512 });
      // 旧字段仍在（老版本读得懂）
      expect(saved.ball).toBeDefined();
    });

    it('没吸边就只落盘 ball、不写 dock', async () => {
      await dragTo(400, 200);
      const saved = savedFile();
      expect(saved.dock).toBeUndefined();
      expect(saved.ball).toBeDefined();
    });

    it('重启后恢复停靠态：建窗即细条 + orb-mode 带 docked=right', async () => {
      await dragTo(1920 - ORB_BALL_SIZE + 20, 333);
      expect(savedFile().dock).toEqual({ side: 'right', y: 333 });

      // 模拟重启：丢掉模块级状态，重新 import（磁盘上的 xiangwo-orb.json 保留）
      vi.resetModules();
      state.handlers.clear();
      FakeBrowserWindow.instances.length = 0;
      const restarted = await import('./xiangwo-orb');
      restarted.createXiangwoOrbWindow(() => {});
      await settle();

      const bounds = orb().getBounds();
      expect([bounds.width, bounds.height]).toEqual([ORB_DOCK_TAB_WIDTH, ORB_DOCK_TAB_HEIGHT]);
      expect(bounds.x).toBe(1920 - ORB_DOCK_TAB_WIDTH);
      expect(bounds.y).toBe(333);

      const mode = await call<unknown[]>('xiangwo:orb-mode');
      expect(mode).toEqual(['ball', false, null, 'right']);
    });

    it('解锁（unsnap）后清掉 dock 字段、窗口回到球态', async () => {
      await dragTo(1920 - ORB_BALL_SIZE + 20, 300);
      const result = await call('xiangwo:orb-api', 'floating.unsnap', {});

      expect(result).toMatchObject({ ok: true, docked: null });
      const bounds = orb().getBounds();
      expect([bounds.width, bounds.height]).toEqual([96, 96]);
      // 解锁后球回到屏内：球体本身（窗口内缩 12px chrome 后那 72px）完全在屏幕里，
      // 且离右沿内缩 ORB_DOCK_IN_PAD(5) —— 窗口那圈 chrome 允许探出屏幕（形状把它裁掉了，跟上游一致）
      expect(bounds.x + 12 + ORB_BALL_SIZE).toBeLessThanOrEqual(
        PRIMARY.bounds.x + PRIMARY.bounds.width
      );
      expect(bounds.x + 12).toBeGreaterThan(PRIMARY.bounds.x + PRIMARY.bounds.width - 80);
      expect(savedFile().dock).toBeUndefined();
      expect(savedFile().ball).toBeDefined();
      expect(await call('xiangwo:orb-mode')).toEqual(['ball', false, null, null]);
    });
  });

  describe('运行时不许停靠（上游 canDock = !(running || asking())）', () => {
    it('running=true 时拖到边缘也拒绝停靠，并且球被夹回工作区', async () => {
      writeFileSync(
        join(state.userData.dir, 'xiangwo-orb-session.json'),
        `${JSON.stringify({ sessionId: 's1', running: true })}\n`,
        'utf8'
      );

      const result = await dragTo(1920 - ORB_BALL_SIZE + 20, 300);
      expect(result.docked).toBeNull();

      const bounds = orb().getBounds();
      expect(bounds.width).toBe(96);
      expect(bounds.x).toBeLessThanOrEqual(
        PRIMARY.workArea.x + PRIMARY.workArea.width - ORB_BALL_SIZE
      );
      expect(savedFile().dock).toBeUndefined();
    });

    it('渲染进程说 canDock=false 也拒绝停靠（提问卡待答那条路）', async () => {
      const result = await dragTo(1920 - ORB_BALL_SIZE + 20, 300, false);
      expect(result.docked).toBeNull();
      expect(orb().getBounds().width).toBe(96);
    });

    it('floating.clamp 在 running 时同样拒绝停靠，并透传 docked=null', async () => {
      await call('xiangwo:orb-drag', 1920 - ORB_BALL_SIZE + 20, 300);
      writeFileSync(
        join(state.userData.dir, 'xiangwo-orb-session.json'),
        `${JSON.stringify({ running: true })}\n`,
        'utf8'
      );
      const clamped = await call<{ docked: string | null }>(
        'xiangwo:orb-api',
        'floating.clamp',
        {}
      );
      expect(clamped.docked).toBeNull();
      expect(orb().getBounds().width).toBe(96);
    });
  });

  describe('多显示器', () => {
    it('停靠目标屏 = 球所在那块屏（第二屏的右沿）', async () => {
      state.displays.push(SECONDARY);
      const result = await dragTo(
        SECONDARY.bounds.x + SECONDARY.bounds.width - ORB_BALL_SIZE + 20,
        200
      );
      expect(result.docked).toBe('right');
      const bounds = orb().getBounds();
      expect(bounds.x).toBe(SECONDARY.bounds.x + SECONDARY.bounds.width - ORB_DOCK_TAB_WIDTH);
      expect(bounds.x + bounds.width).toBe(SECONDARY.bounds.x + SECONDARY.bounds.width);
    });
  });

  describe('floating.move / xiangwo:orb-mode 透传 docked', () => {
    it('floating.move 返回当前停靠侧', async () => {
      await dragTo(1920 - ORB_BALL_SIZE + 20, 300);
      const moved = await call<{ docked: string | null }>('xiangwo:orb-api', 'floating.move', {
        x: 500,
        y: 500,
      });
      // 拖动过程中是自由的（松手才提交停靠），所以这里已经开始解锁
      expect(moved.docked).toBeNull();
    });

    it('吸边/解锁时都会推 xiangwo:orb-mode（带 docked 字段）', async () => {
      const win = orb();
      win.sent.length = 0;
      await dragTo(1920 - ORB_BALL_SIZE + 20, 300);
      expect(win.sent.some((args) => args[0] === 'xiangwo:orb-mode' && args[4] === 'right')).toBe(
        true
      );

      win.sent.length = 0;
      await call('xiangwo:orb-api', 'floating.unsnap', {});
      expect(win.sent.some((args) => args[0] === 'xiangwo:orb-mode' && args[4] === null)).toBe(
        true
      );
    });
  });
});

// [XG-CUSTOM 2026-10-05] 显示器变化重夹：上游 orb 没有 display 事件监听（实测 0 命中），
// 拔掉球所在的那块屏之后球会留在已经不存在的坐标上（用户看不见球）—— 这两条就是那个补丁的回归网。
describe('[XG-CUSTOM] 显示器变化后重夹（多屏 / 改分辨率 / 拔插外接屏）', () => {
  /** 250ms 防抖 + 余量 */
  const afterDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 320));

  it('拔掉球所在的外接屏 → 球被夹回主屏 work-area，并写回位置记忆', async () => {
    const win = orb();
    const size = win.getBounds().width;
    state.displays.push(SECONDARY);
    // 假窗口自己会往 screenBounds 里夹 → 先铺成两屏的并集，才放得到第二块屏上
    FakeBrowserWindow.screenBounds = { x: 0, y: 0, width: 3200, height: 1080 };
    win.setBounds({ x: 2500, y: 300, width: size, height: size });
    expect(win.getBounds().x).toBeGreaterThan(1900);

    // 拔屏：只剩主屏
    state.displays.length = 0;
    state.displays.push(PRIMARY);
    state.screenEmit('display-removed');
    await afterDebounce();

    const b = win.getBounds();
    // ⚠️ 断言的是**球**，不是窗口：窗口 = 球 + 一圈 12px 透明 chrome（ORB_CHROME_INSET），
    // 所以窗口右缘可以合法地探出 work-area 12px（第一版断言写错过：1932 vs 1920）。
    const ball = { x: b.x + 12, y: b.y + 12 };
    expect(ball.x).toBeGreaterThanOrEqual(PRIMARY.workArea.x);
    expect(ball.x + ORB_BALL_SIZE).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
    expect(ball.y + ORB_BALL_SIZE).toBeLessThanOrEqual(
      PRIMARY.workArea.y + PRIMARY.workArea.height
    );
    expect(savedFile().ball?.x).toBeLessThan(1920);
  });

  it('停靠态遇到显示器变化 → 细条按新屏幕边重算（不会留在旧屏幕坐标上）', async () => {
    const win = orb();
    await dragTo(1920 - ORB_BALL_SIZE + 20, 300); // 吸到主屏右沿
    expect(win.getBounds().width).toBe(ORB_DOCK_TAB_WIDTH);

    // 主屏变窄（模拟改分辨率 / 换屏）
    state.displays[0] = {
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      workArea: { x: 0, y: 0, width: 1280, height: 700 },
      scaleFactor: 1,
    };
    FakeBrowserWindow.screenBounds = { ...state.displays[0].bounds };
    state.screenEmit('display-metrics-changed');
    await afterDebounce();

    // 细条贴的是**屏幕真边**（display.bounds，不是 work-area）
    expect(win.getBounds().x).toBe(1280 - ORB_DOCK_TAB_WIDTH);
    expect(win.getBounds().width).toBe(ORB_DOCK_TAB_WIDTH);
  });
});
