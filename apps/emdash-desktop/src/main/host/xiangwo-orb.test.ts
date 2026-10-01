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
  return { userData, displays, handlers };
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

/** 拖到 (x, y) 然后松手，返回主进程给的停靠结论 */
async function dragTo(x: number, y: number, canDock = true): Promise<{ ok: boolean; docked: string | null }> {
  await call('xiangwo:orb-drag', x, y);
  const result = await call<{ ok: boolean; docked: string | null }>(
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
  FakeBrowserWindow.instances.length = 0;
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
      expect(dockSideForBallOrigin({ x: 1920 - ORB_BALL_SIZE + ORB_DOCK_OVERLAP - 1, y: 100 }, bounds)).toBe(
        undefined
      );
    });

    it('刚好压住球宽 1/5 就吸边', () => {
      expect(dockSideForBallOrigin({ x: 1920 - ORB_BALL_SIZE + ORB_DOCK_OVERLAP, y: 100 }, bounds)).toBe(
        'right'
      );
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

      expect(result).toEqual({ ok: true, docked: 'right' });
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

      expect(result).toEqual({ ok: true, docked: null });
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
      expect(bounds.x).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width - ORB_BALL_SIZE);
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
      const clamped = await call<{ docked: string | null }>('xiangwo:orb-api', 'floating.clamp', {});
      expect(clamped.docked).toBeNull();
      expect(orb().getBounds().width).toBe(96);
    });
  });

  describe('多显示器', () => {
    it('停靠目标屏 = 球所在那块屏（第二屏的右沿）', async () => {
      state.displays.push(SECONDARY);
      const result = await dragTo(SECONDARY.bounds.x + SECONDARY.bounds.width - ORB_BALL_SIZE + 20, 200);
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
      expect(win.sent.some((args) => args[0] === 'xiangwo:orb-mode' && args[4] === 'right')).toBe(true);

      win.sent.length = 0;
      await call('xiangwo:orb-api', 'floating.unsnap', {});
      expect(win.sent.some((args) => args[0] === 'xiangwo:orb-mode' && args[4] === null)).toBe(true);
    });
  });
});
