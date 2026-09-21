import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { desktopHostEvents } from '@core/features/workbench/node';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
import type { Theme } from '@core/primitives/app-settings/api';
import { recordWindowVisible } from '@main/bootstrap/core/boot-report';
import { reportBootSuccessSignal } from '@main/bootstrap/core/boot-status';
import {
  isShutdownInProgress,
  shouldAllowWindowClose,
  watchWindow,
} from '@main/bootstrap/shutdown';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import {
  hardenBrowserWebviewPreferences,
  stripBrowserWebviewParams,
  validateBrowserWebviewAttach,
} from '@main/host/browser/webview-security';
import { registerExternalLinkHandlers } from '@main/host/externalLinks';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { APP_ORIGIN } from './protocol';

let mainWindow: BrowserWindow | null = null;

export function applyNativeTheme(theme: Theme): void {
  if (process.platform !== 'win32') return;
  nativeTheme.themeSource = theme === 'emdark' ? 'dark' : theme === 'emlight' ? 'light' : 'system';
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    title: PRODUCT_NAME,
    // sRGB approximation of the theme --background tokens, so the window that
    // appears before the splash paints is not a white flash. System-theme
    // heuristic: the DB-backed app theme is not readable this early; the
    // splash corrects to the persisted theme as soon as index.html parses.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    // In production, electron-builder injects the icon from the app bundle.
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Required for ESM preload scripts (.mjs)
      sandbox: false,
      // Allow using <webview> in renderer for in‑app browser pane.
      // The webview runs in a separate process; nodeIntegration remains disabled.
      webviewTag: true,
      // app.getAppPath() is stable regardless of which output chunk this module
      // lands in after code splitting. Preload is built to out/preload/index.mjs.
      preload: join(app.getAppPath(), 'out', 'preload', 'index.mjs'),
    },
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 10, y: 10 },
          acceptFirstMouse: true,
        }
      : {}),
    // Linux: go fully frameless and draw our own window controls in the
    // renderer (see WindowControls). Electron's native titleBarOverlay is
    // experimental/inconsistent across desktop environments, so we avoid it —
    // this mirrors how VSCode handles its custom title bar on Linux.
    ...(process.platform === 'linux' ? { frame: false } : {}),
    show: false,
  });
  watchWindow(mainWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    log.info('boot-timeline', {
      mark: 'window-did-finish-load',
      sinceProcessStartMs: Date.now() - (process.getCreationTime() ?? Date.now()),
    });
    // One of the two boot success signals; the crash-loop marker clears only
    // when the backend chain has also finished (see boot-status).
    reportBootSuccessSignal('window-load');
  });

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  const rendererUrl = import.meta.env.DEV
    ? process.env.ELECTRON_RENDERER_URL!
    : `${APP_ORIGIN}/index.html`;
  void mainWindow.loadURL(rendererUrl);

  // Route anything outside the renderer origin through the external-link flow
  registerExternalLinkHandlers(mainWindow, rendererUrl);
  registerBrowserWebviewHandlers(mainWindow);

  // Window-first: show immediately with the theme-matching background instead
  // of waiting for ready-to-show. For a module-script page, ready-to-show only
  // fires once the whole renderer bundle has evaluated (DOMContentLoaded waits
  // on deferred scripts), which would hide the window — and the splash — for
  // the full renderer load. Electron's own guidance for complex apps is to
  // show immediately with a backgroundColor; the static splash in index.html
  // paints on top as soon as the HTML parses.
  mainWindow.show();
  const windowVisibleMs = Date.now() - (process.getCreationTime() ?? Date.now());
  log.info('boot-timeline', { mark: 'window-visible', sinceProcessStartMs: windowVisibleMs });
  recordWindowVisible(windowVisibleMs);

  // Diagnostic only (the window is already visible): marks when the renderer
  // produced its first full frame.
  mainWindow.once('ready-to-show', () => {
    log.info('boot-timeline', {
      mark: 'window-ready-to-show',
      sinceProcessStartMs: Date.now() - (process.getCreationTime() ?? Date.now()),
    });
  });

  // Track window focus for telemetry
  mainWindow.on('focus', () => {
    telemetryService.capture('app_window_focused');
    if (typeof mainWindow?.setWindowButtonVisibility === 'function') {
      mainWindow.setWindowButtonVisibility(true);
    }
    void telemetryService.checkAndReportDailyActiveUser();
  });

  mainWindow.on('blur', () => {
    telemetryService.capture('app_window_unfocused');
  });

  mainWindow.on('close', (event) => {
    if (shouldAllowWindowClose()) return;
    event.preventDefault();
    if (isShutdownInProgress()) return;
    mainWindow?.hide();
  });

  // Keep the renderer's custom window controls (Linux) in sync with the
  // actual maximize state so the maximize/restore icon stays correct.
  mainWindow.on('maximize', () => {
    desktopHostEvents.emit(undefined, { type: 'window-maximize-changed', maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    desktopHostEvents.emit(undefined, { type: 'window-maximize-changed', maximized: false });
  });

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// [XG-CUSTOM] 项我侧边聊天浮窗：独立置顶小窗，拖到任意浏览器（Chrome/Edge/Firefox/360/夸克）
// 旁边当「侧边聊天框」。加载 index.html 的 #xiangwo-floating 路由，聊天逻辑复用项我窗。
let xiangwoFloatingWindow: BrowserWindow | null = null;

// [XG-CUSTOM] CDP 桥接：浮窗 📷 截图当前浏览器标签页 / 拿当前标签页 URL。
// 通过 CDP（Chrome remote-debugging-port 9222）连 wego-lite 的真 Chrome。
const CDP_BASE = 'http://127.0.0.1:9222';

let cdpBridgeRegistered = false;

async function getCurrentTab(): Promise<
  { type?: string; url?: string; active?: boolean; webSocketDebuggerUrl?: string } | undefined
> {
  try {
    const res = await fetch(`${CDP_BASE}/json`);
    const tabs = (await res.json()) as Array<{
      type?: string; url?: string; active?: boolean; webSocketDebuggerUrl?: string;
    }>;
    return tabs.find((t) => t.type === 'page' && t.active) ?? tabs.find((t) => t.type === 'page');
  } catch {
    return undefined;
  }
}

function cdpCall(wsUrl: string, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP timeout'));
    }, 10000);
    ws.onopen = () => {
      msgId += 1;
      ws.send(JSON.stringify({ id: msgId, method, params }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as {
        id?: number; result?: unknown; error?: { message?: string };
      };
      if (msg.id === msgId) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message ?? 'CDP error'));
        else resolve(msg.result);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('CDP websocket error'));
    };
  });
}

export function registerXiangwoCdpBridge(): void {
  ipcMain.handle('xiangwo:capture-current-tab', async () => {
    const tab = await getCurrentTab();
    if (!tab?.webSocketDebuggerUrl) throw new Error('没有可用的浏览器页面标签');
    const result = (await cdpCall(tab.webSocketDebuggerUrl, 'Page.captureScreenshot', {
      format: 'png',
    })) as { data?: string };
    return `data:image/png;base64,${result.data ?? ''}`;
  });
  ipcMain.handle('xiangwo:get-current-tab-url', async () => {
    const tab = await getCurrentTab();
    return tab?.url ?? '';
  });
}

// [XG-CUSTOM] 交接台桥接：subprocess 调 wego-lite/task-spaces.mjs（Node CLI，输出 JSON）。
// 命令：list / handoff <id> / takeover <id> / complete <id> <keep>。
const TASK_SPACES_MJS =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/wego-lite/task-spaces/task-spaces.mjs';

function taskSpaceCall(cmd: string, ...args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [TASK_SPACES_MJS, cmd, ...args]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`task-spaces exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(out);
      }
    });
  });
}

export function registerXiangwoTaskSpaces(): void {
  ipcMain.handle('xiangwo:task-space-list', () => taskSpaceCall('list'));
  ipcMain.handle('xiangwo:task-space-handoff', (_e, id: string) => taskSpaceCall('handoff', id));
  ipcMain.handle('xiangwo:task-space-takeover', (_e, id: string) => taskSpaceCall('takeover', id));
  ipcMain.handle('xiangwo:task-space-complete', (_e, id: string, keep: boolean) =>
    taskSpaceCall('complete', id, keep ? 'true' : 'false')
  );
}

// [XG-CUSTOM] 专家交接平台桥接：subprocess 调 wego-lite/expert-handoff/expert-handoff.mjs（Node CLI，输出 JSON）。
// 命令：by-expert <expert> / accept <id> / delete <id>。
const EXPERT_HANDOFF_MJS =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/wego-lite/expert-handoff/expert-handoff.mjs';

function expertHandoffCall(cmd: string, ...args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [EXPERT_HANDOFF_MJS, cmd, ...args]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`expert-handoff exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(out);
      }
    });
  });
}

export function registerXiangwoExpertHandoff(): void {
  ipcMain.handle('xiangwo:expert-handoff-by-expert', (_e, expert: string) =>
    expertHandoffCall('by-expert', expert)
  );
  ipcMain.handle('xiangwo:expert-handoff-accept', (_e, id: string) =>
    expertHandoffCall('accept', id)
  );
  ipcMain.handle('xiangwo:expert-handoff-delete', (_e, id: string) =>
    expertHandoffCall('delete', id)
  );
}

// [XG-CUSTOM] 一键组合：浮窗 + 真实 Chrome。拉起 CDP Chrome（若没跑），
// 用真实指纹/登录态抓外网（pixiv/Google 等），与 wego-lite 共用同一 profile。
const CHROME_CMD = 'google-chrome-stable';
const CHROME_PROFILE = '/persistent/home/xgqlover/.wego-lite/chrome-profile';

export async function ensureChromeRunning(): Promise<void> {
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    if (res.ok) {
      // Chrome 已在跑：把当前标签页窗口带到前台（否则用户点了浮窗看不到网页）
      const tabs = (await res.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const tab = tabs.find((t) => t.type === 'page');
      if (tab?.webSocketDebuggerUrl) {
        try {
          await cdpCall(tab.webSocketDebuggerUrl, 'Page.bringToFront');
        } catch {
          // 带到前台失败忽略（Chrome 可能正在启动）
        }
      }
      return;
    }
  } catch {
    // Chrome 没跑，继续拉起
  }
  const child = spawn(
    CHROME_CMD,
    [
      '--remote-debugging-port=9222',
      `--user-data-dir=${CHROME_PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

export function createXiangwoFloatingWindow(): BrowserWindow {
  // [XG-CUSTOM] CDP 桥接只注册一次（ipcMain.handle 重复注册会抛错）
  if (!cdpBridgeRegistered) {
    cdpBridgeRegistered = true;
    registerXiangwoCdpBridge();
    registerXiangwoTaskSpaces();
    registerXiangwoExpertHandoff();
  }
  if (xiangwoFloatingWindow && !xiangwoFloatingWindow.isDestroyed()) {
    xiangwoFloatingWindow.show();
    xiangwoFloatingWindow.focus();
    return xiangwoFloatingWindow;
  }
  xiangwoFloatingWindow = new BrowserWindow({
    width: 360,
    height: 640,
    minWidth: 280,
    minHeight: 320,
    title: '项我侧边聊天',
    alwaysOnTop: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      // [XG-CUSTOM] 浮窗标志：renderer 通过 process.argv 读到它，直接走浮窗渲染。
      // 不依赖 URL（app:// 协议下 query/hash 都会被 net.fetch(file://) 吞掉）。
      additionalArguments: ['--xiangwo-floating'],
      preload: join(app.getAppPath(), 'out', 'preload', 'index.mjs'),
    },
    ...(process.platform === 'linux' ? { frame: false } : {}),
    show: false,
  });
  if (process.platform !== 'darwin') {
    xiangwoFloatingWindow.setMenuBarVisibility(false);
  }
  xiangwoFloatingWindow.setAlwaysOnTop(true, 'floating');
  if (import.meta.env.DEV) {
    void xiangwoFloatingWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL!}?xiangwo-floating=1`);
  } else {
    void xiangwoFloatingWindow.loadURL(`${APP_ORIGIN}/index.html?xiangwo-floating=1`);
  }
  xiangwoFloatingWindow.once('ready-to-show', () => {
    xiangwoFloatingWindow?.show();
    xiangwoFloatingWindow?.focus();
  });
  xiangwoFloatingWindow.show();
  xiangwoFloatingWindow.focus();
  // [XG-CUSTOM] 浮窗加载完成后直接移除 boot-splash（不依赖 renderer 的 classList 时序）。
  // splash 是 z-index 2147483647 的全屏覆盖层，不 remove 会盖住浮窗且挡住交互。
  xiangwoFloatingWindow.webContents.on('did-finish-load', () => {
    xiangwoFloatingWindow?.webContents
      .executeJavaScript("document.getElementById('boot-splash')?.remove();")
      .catch(() => {});
  });
  xiangwoFloatingWindow.on('closed', () => {
    xiangwoFloatingWindow = null;
  });
  return xiangwoFloatingWindow;
}

// [XG-CUSTOM] WeKnora 窗口：本地知识库/资料加工台（WeKnora 前端 9036，后端 API 9035）。
// ⚠️ 3010 是 AFFiNE（不是 WeKnora），WeKnora 前端是 9036（容器 FRONTEND_PORT 映射）。
// 设置→集成里 WeKnora 卡片点「打开」→ 弹出这个窗口加载 WeKnora UI。
let weKnoraWindow: BrowserWindow | null = null;

export function createWeKnoraWindow(url = 'http://127.0.0.1:9036'): BrowserWindow {
  if (weKnoraWindow && !weKnoraWindow.isDestroyed()) {
    weKnoraWindow.show();
    weKnoraWindow.focus();
    return weKnoraWindow;
  }
  weKnoraWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'WeKnora 知识库',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void weKnoraWindow.loadURL(url);
  weKnoraWindow.once('ready-to-show', () => {
    weKnoraWindow?.show();
    weKnoraWindow?.focus();
  });
  weKnoraWindow.show();
  weKnoraWindow.on('closed', () => {
    weKnoraWindow = null;
  });
  return weKnoraWindow;
}

// [XG-CUSTOM] T8 窗口：AI 生成工作流引擎画板（T8 前端 18766，执行引擎 comfyui/volcengine 等）。
// 设置→集成里 T8 卡片点「打开」→ 弹出这个窗口加载 T8 画板。
let t8Window: BrowserWindow | null = null;

export function createT8Window(url = 'http://127.0.0.1:18766'): BrowserWindow {
  if (t8Window && !t8Window.isDestroyed()) {
    t8Window.show();
    t8Window.focus();
    return t8Window;
  }
  t8Window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'T8 画板',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void t8Window.loadURL(url);
  t8Window.once('ready-to-show', () => {
    t8Window?.show();
    t8Window?.focus();
  });
  t8Window.show();
  t8Window.on('closed', () => {
    t8Window = null;
  });
  return t8Window;
}

export function showMainWindow(): BrowserWindow {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  } else {
    app.focus();
  }
  win.focus();
  return win;
}

export function isAppFocused(): boolean {
  const windows = BrowserWindow.getAllWindows();
  return windows.some((window) => !window.isDestroyed() && window.isFocused());
}

export function focusAppFromNotification(): BrowserWindow | null {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return null;
  return showMainWindow();
}

function registerBrowserWebviewHandlers(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const validation = validateBrowserWebviewAttach(
      params,
      browserWebContentsRegistry.registeredPartitions
    );
    if (!validation.ok) {
      event.preventDefault();
      log.warn('Denied browser webview attachment', { reason: validation.reason });
      return;
    }

    hardenBrowserWebviewPreferences(webPreferences);
    stripBrowserWebviewParams(params);
  });

  win.webContents.on('did-attach-webview', (_event, webContents) => {
    if (!browserWebContentsRegistry.handleWebviewAttached(webContents)) {
      log.warn('Closed webview without a registered browser session');
    }
  });
}
