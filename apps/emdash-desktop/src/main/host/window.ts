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
// [XG-CUSTOM] 项我控制球（球/面板两态 + 悬停展开 + 位置记忆）
import { createXiangwoOrbWindow } from './xiangwo-orb';
// [XG-CUSTOM] 项我球/浮窗的聊天地址解析（渲染进程不猜主机；规则见该文件头）
import {
  configureXiangwoChatTargetDeps,
  resolveXiangwoChatTarget,
  type XiangwoChatTargetDeps,
} from './xiangwo-chat-target';
import { runXiangwoScript } from './xiangwo-script-runner';
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

/**
 * [XG-CUSTOM] 页面清理：agent 打开的网页太多会把机器拖死（用户这台已经被 Chrome 一堆 page + swap
 * 满卡过），所以球面板要能"看见 + 一键关掉"。
 *
 * **过滤规则**：CDP `/json` 里同时有平台自己的页面（127.0.0.1/localhost 的 emdash/wego-lite 页面、
 * chrome:// 内部页、扩展页）和 agent 真正打开的外网页。无法 100% 可靠区分"谁开的"，
 * 所以这里采用保守规则：**只把"非本地、非 chrome://、非扩展"的 http(s) 页面算作 agent 网页**
 * （注释与 UI 都写明"只列/只关外部网页"），绝不误关平台页或用户自己开的本地页。
 */
type XiangwoPageInfo = { id: string; title: string; url: string };

function isLocallyOwnedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    const host = parsed.hostname;
    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      host === '0.0.0.0'
    );
  } catch {
    return true; // 解析不出来的（about:blank / chrome:// / devtools:// 等）一律不当成 agent 网页
  }
}

/** 列 agent 网页（CDP 不可达 → ok:false + 人话提示，绝不抛错崩溃） */
async function listXiangwoPages(): Promise<
  { ok: true; pages: XiangwoPageInfo[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${CDP_BASE}/json`);
    if (!res.ok) return { ok: false, error: `浏览器调试端口返回 ${res.status}` };
    const raw = (await res.json()) as Array<{ id?: string; title?: string; url?: string; type?: string }>;
    const pages = raw
      .filter((t) => (t.type ?? 'page') === 'page')
      .filter((t) => typeof t.url === 'string' && !isLocallyOwnedUrl(t.url))
      .slice(0, 50)
      .map((t) => ({
        id: String(t.id ?? ''),
        title: (t.title ?? '').trim() === '' ? '(无标题)' : String(t.title).slice(0, 120),
        url: String(t.url ?? '').slice(0, 300),
      }))
      .filter((t) => t.id !== '');
    return { ok: true, pages };
  } catch {
    return { ok: false, error: '连不上浏览器调试端口（Chrome/wego-lite 没在跑），暂时看不到 agent 网页' };
  }
}

/** 关页面：走 HTTP `/json/close/<id>`（比开 WS 发 Target.closeTarget 轻，也不用管连接生命周期） */
async function closeXiangwoPages(
  ids: string[]
): Promise<{ ok: true; closed: string[]; failed: string[] }> {
  const closed: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${CDP_BASE}/json/close/${encodeURIComponent(id)}`);
      if (res.ok) closed.push(id);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { ok: true, closed, failed };
}

export function registerXiangwoCdpBridge(): void {
  // [XG-CUSTOM] 列/关 agent 网页（球面板的"网页 N"控件用）
  ipcMain.handle('xiangwo:pages', async () => listXiangwoPages());
  ipcMain.handle(
    'xiangwo:close-pages',
    async (_event, args: { ids?: unknown; all?: unknown } | undefined) => {
      const all = args?.all === true;
      const ids = Array.isArray(args?.ids)
        ? args.ids.filter((id): id is string => typeof id === 'string' && id !== '')
        : [];
      if (!all && ids.length === 0) return { ok: true, closed: [], failed: [] };
      // all → 先列一遍（只关"外部网页"，平台页/本地页不动）
      const targets = all ? (await listXiangwoPages()) : undefined;
      if (all && targets !== undefined && targets.ok === false) return { ok: true, closed: [], failed: [] };
      const list = all ? (targets as { ok: true; pages: XiangwoPageInfo[] }).pages : undefined;
      const toClose = list !== undefined ? list.map((p) => p.id) : ids;
      return closeXiangwoPages(toClose);
    }
  );
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

// [XG-CUSTOM] 交接台桥接：调 wego-lite/task-spaces.mjs（Node CLI，输出 JSON）。
// 命令：list / handoff <id> / takeover <id> / complete <id> <keep>。
// [XG-CUSTOM] 原来把 Linux 绝对路径写死并直接 spawn —— Windows 客户端（远程主机）上必然 ENOENT。
// 现在交给主机感知的 runXiangwoScript：本机 = 本地 spawn、远程 = 走 SSH 在主机上跑，
// 失败给人话错误（见 main/host/xiangwo-script-runner.ts）。
const TASK_SPACES_MJS =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/wego-lite/task-spaces/task-spaces.mjs';

// [XG-CUSTOM] 浏览器工作台 task-spaces 调用（泛型返回，适配 ProcedureDef 具体类型）
// 两个入口共用这一个实现：
//   ① emdash「交接台」第二个 Tab（走 Wire host 域 → wiring.ts）
//   ② 项我球浮窗的「📤 交接」按钮（走 IPC xiangwo:task-space-*，见 registerXiangwoTaskSpaces）
export function taskSpaceCall<T = unknown>(cmd: string, ...args: string[]): Promise<T> {
  return runXiangwoScript({
    label: '浏览器工作台',
    interpreter: {
      local: 'node',
      remote: 'node',
      // 这台主机的 node 是 nvm 装的（sshd 非交互 exec 里没有 nvm 的 PATH）→ 给兜底绝对路径
      remoteSearchPaths: [
        '"$HOME"/.nvm/versions/node/*/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node',
      ],
    },
    scriptPath: TASK_SPACES_MJS,
    envVar: 'XIANGWO_TASK_SPACES_MJS',
    args: [cmd, ...args],
  }) as Promise<T>;
}

export function registerXiangwoTaskSpaces(): void {
  ipcMain.handle('xiangwo:task-space-list', () => taskSpaceCall('list'));
  ipcMain.handle('xiangwo:task-space-handoff', (_e, id: string) => taskSpaceCall('handoff', id));
  ipcMain.handle('xiangwo:task-space-takeover', (_e, id: string) => taskSpaceCall('takeover', id));
  ipcMain.handle('xiangwo:task-space-complete', (_e, id: string, keep: boolean) =>
    taskSpaceCall('complete', id, keep ? 'true' : 'false')
  );
}

// [XG-CUSTOM] 专家交接平台桥接：调 xiangwo-agent/expert_handoff.py（session 隔离版 CLI，输出 JSON）。
// 与 agent.py 后端共用同一模块 + 同一数据文件，保证 session 隔离逻辑只有一份。
// 命令：by-expert <expert> [session] / accept <id> / delete <id>。
const EXPERT_HANDOFF_PY =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo-agent/expert_handoff.py';

// [XG-CUSTOM] 专家交接台 CLI 调用（泛型返回，适配 ProcedureDef 具体类型）
export function expertHandoffCall<T = unknown>(cmd: string, ...args: string[]): Promise<T> {
  return runXiangwoScript({
    label: '专家交接台',
    interpreter: {
      local: '/usr/bin/python3',
      remote: 'python3',
      remoteSearchPaths: ['/usr/bin/python3', '/usr/local/bin/python3'],
    },
    scriptPath: EXPERT_HANDOFF_PY,
    envVar: 'XIANGWO_EXPERT_HANDOFF_PY',
    args: [cmd, ...args],
  }) as Promise<T>;
}

// [XG-CUSTOM] Pi 树专家名册桥接：调 xiangwo-agent/expert_roster.py roster（输出 JSON）。
// 与交接台同款主机感知（local spawn / remote ssh），数据源是宿主机上的 suagent_registry + Pi 树。
const EXPERT_ROSTER_PY =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo-agent/expert_roster.py';

export function expertRosterCall<T = unknown>(): Promise<T> {
  return runXiangwoScript({
    label: '专家总览',
    interpreter: {
      local: '/usr/bin/python3',
      remote: 'python3',
      remoteSearchPaths: ['/usr/bin/python3', '/usr/local/bin/python3'],
    },
    scriptPath: EXPERT_ROSTER_PY,
    envVar: 'XIANGWO_EXPERT_ROSTER_PY',
    args: ['roster'],
  }) as Promise<T>;
}

// [XG-CUSTOM 2026-10-08] Kaneo 看板桥接：调 xiangwo-agent/kaneo_board.py board（输出 JSON）。
// 用途 =「自动化」视图的 **Kaneo 面板**：在那个界面里看着卡排自动化。
// 与 expertRoster 同款主机感知（本机 spawn / 远程 ssh）。
// ⚠️ 那个脚本内部**必须分页**取卡 —— `list_tasks` 的 limit 上限是 100，
//    而单个项目已超 100 张（实测 BABADO 110 张），不分页会静默漏卡。
const KANEO_BOARD_PY =
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo-agent/kaneo_board.py';

export function kaneoBoardCall<T = unknown>(brief = false): Promise<T> {
  return runXiangwoScript({
    label: 'Kaneo 看板',
    interpreter: {
      local: '/usr/bin/python3',
      remote: 'python3',
      remoteSearchPaths: ['/usr/bin/python3', '/usr/local/bin/python3'],
    },
    scriptPath: KANEO_BOARD_PY,
    envVar: 'XIANGWO_KANEO_BOARD_PY',
    args: brief ? ['board', '--brief'] : ['board'],
  }) as Promise<T>;
}

// [XG-CUSTOM] 项我球 / 旧浮窗的聊天地址：注册 `xiangwo:resolve-chat-url`
// （preload: electronAPI.resolveXiangwoChatUrl）。解析规则/依赖注入见 main/host/xiangwo-chat-target.ts，
// 真实依赖（db 里的 SSH 主机 + services.forwardManualPreview）在 boot 时注入。
let chatTargetRegistered = false;

export function registerXiangwoChatTarget(deps: XiangwoChatTargetDeps): void {
  configureXiangwoChatTargetDeps(deps);
  if (chatTargetRegistered) return;
  chatTargetRegistered = true;
  ipcMain.handle('xiangwo:resolve-chat-url', () => resolveXiangwoChatTarget());
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
  ipcMain.handle('xiangwo:expert-handoff-list', (_e, bot: string, session: string) =>
    expertHandoffCall('list', bot, session)
  );
  // [XG-CUSTOM] 新建交接
  ipcMain.handle(
    'xiangwo:expert-handoff-add',
    (_e, bot: string, expert: string, title: string, summary: string, session: string, context: string) =>
      expertHandoffCall('add', bot, expert, title, summary, session, context)
  );
}

// [XG-CUSTOM] 一键组合：浮窗 + 真实 Chrome。拉起 CDP Chrome（若没跑），
// 用真实指纹/登录态抓外网（pixiv/Google 等），与 wego-lite 共用同一 profile。
const CHROME_CMD = 'google-chrome-stable';
const CHROME_PROFILE = '/persistent/home/xgqlover/.wego-lite/chrome-profile';

export async function ensureChromeRunning(): Promise<void> {
  // [XG-CUSTOM] 真实 Chrome CDP（9222）只在 Linux 本机（wego-lite）有用。
  // Windows 客户端没有 google-chrome-stable，spawn 会 error 且无监听 → 主进程崩溃（点悬浮按钮闪退）。
  if (process.platform !== 'linux') return;
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
  // [XG-CUSTOM] 升级为「项我控制球」：球壳/几何/置顶档/位置记忆都在 main/host/xiangwo-orb.ts
  xiangwoFloatingWindow = createXiangwoOrbWindow(() => {
    const main = BrowserWindow.getAllWindows().find((w) => w !== xiangwoFloatingWindow && !w.isDestroyed());
    main?.show();
    main?.focus();
  });
  return xiangwoFloatingWindow;
}


// [XG-CUSTOM] WeKnora 窗口：本地知识库/资料加工台（WeKnora 前端 9037，后端 API 9035）。
// ⚠️ 3010 是 AFFiNE（不是 WeKnora）；9036 是孤儿 nginx 容器（502 弃用），9037 是宿主机 nginx 代理。
// 设置→集成里 WeKnora 卡片点「打开」→ 弹出这个窗口加载 WeKnora UI。
let weKnoraWindow: BrowserWindow | null = null;

export function createWeKnoraWindow(url = 'http://127.0.0.1:9037'): BrowserWindow {
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

// [XG-CUSTOM 2026-10-06] OpenDesign 窗口：本地优先设计工作台（daemon 7456）。
// 上游 nexu-io/open-design（Apache-2.0），本地副本 = 工具链/open-design（v0.24.1）。
// 设置→集成里 OpenDesign 卡片点「打开」→ 弹出这个窗口加载 OpenDesign UI。
// ⚠️ 照 WeKnora/Kaneo 模板；地址由 wiring.ts 的 resolveToolWindowUrl(7456) 解析，不写死 127.0.0.1。
let openDesignWindow: BrowserWindow | null = null;

export function createOpenDesignWindow(url = 'http://127.0.0.1:7456'): BrowserWindow {
  if (openDesignWindow && !openDesignWindow.isDestroyed()) {
    openDesignWindow.show();
    openDesignWindow.focus();
    return openDesignWindow;
  }
  openDesignWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenDesign 设计工作台',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void openDesignWindow.loadURL(url);
  openDesignWindow.once('ready-to-show', () => {
    openDesignWindow?.show();
    openDesignWindow?.focus();
  });
  openDesignWindow.show();
  openDesignWindow.on('closed', () => {
    openDesignWindow = null;
  });
  return openDesignWindow;
}

// [XG-CUSTOM 2026-10-09] WorkRally 本地出图**参数面板**窗口（scripts/workrally_local_server.py，8189）。
// 为什么单开一个窗口：OpenDesign 聊天窗里的 `<question-form>` 是**每回合一次**的卡片（改完点生成），
// 而调参是**反复试**的活（换 seed 做 A/B、加减步数）⇒ 用这块**常驻面板**当「甲」那一半：
// 参数留在面板里（localStorage）、增强提示词、一键出图、图直接回显。
// ⚠️ 全本地：面板本身不发外网请求；出图走本机壳 8199 → Win ComfyUI。
// ⚠️ 照 WeKnora/Kaneo/OpenDesign 模板；地址由 wiring.ts 的 resolveToolWindowUrl(8189, '/panel') 解析，不写死。
let workRallyPanelWindow: BrowserWindow | null = null;

export function createWorkRallyPanelWindow(url = 'http://127.0.0.1:8189/panel'): BrowserWindow {
  if (workRallyPanelWindow && !workRallyPanelWindow.isDestroyed()) {
    workRallyPanelWindow.show();
    workRallyPanelWindow.focus();
    return workRallyPanelWindow;
  }
  workRallyPanelWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 780,
    minHeight: 560,
    title: 'WorkRally 本地出图 · 参数面板',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101215' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void workRallyPanelWindow.loadURL(url);
  workRallyPanelWindow.once('ready-to-show', () => {
    workRallyPanelWindow?.show();
    workRallyPanelWindow?.focus();
  });
  workRallyPanelWindow.show();
  workRallyPanelWindow.on('closed', () => {
    workRallyPanelWindow = null;
  });
  return workRallyPanelWindow;
}

// [XG-CUSTOM] OpenViking 窗口：自进化上下文数据库 Studio（1933，viking:// 虚拟文件系统）。
// 设置→集成里 OpenViking 卡片点「打开」→ 弹出这个窗口加载 OpenViking Studio。
let openVikingWindow: BrowserWindow | null = null;

export function createOpenVikingWindow(url = 'http://127.0.0.1:1933/studio'): BrowserWindow {
  if (openVikingWindow && !openVikingWindow.isDestroyed()) {
    openVikingWindow.show();
    openVikingWindow.focus();
    return openVikingWindow;
  }
  openVikingWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenViking 上下文数据库',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void openVikingWindow.loadURL(url);
  openVikingWindow.once('ready-to-show', () => {
    openVikingWindow?.show();
    openVikingWindow?.focus();
  });
  openVikingWindow.show();
  openVikingWindow.on('closed', () => {
    openVikingWindow = null;
  });
  return openVikingWindow;
}


// [XG-CUSTOM] Kaneo 窗口：项我统一工作平台的「流程枢纽」（工作项/交接/依赖/审计，5180）。
// 设置→集成里 Kaneo 卡片点「打开」→ 弹出这个窗口加载 Kaneo 看板。
// 定位：只放「谁在做什么、做到哪、卡在谁那」；知识→Pi 树、内容→OpenViking、
//       提示词库/PR→emdash 自带、无限画布→T8。Kaneo 做引用，不做存储。
let kaneoWindow: BrowserWindow | null = null;

export function createKaneoWindow(url = 'http://127.0.0.1:5180'): BrowserWindow {
  if (kaneoWindow && !kaneoWindow.isDestroyed()) {
    kaneoWindow.show();
    kaneoWindow.focus();
    return kaneoWindow;
  }
  kaneoWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'Kaneo 工作流枢纽',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void kaneoWindow.loadURL(url);
  kaneoWindow.once('ready-to-show', () => {
    kaneoWindow?.show();
    kaneoWindow?.focus();
  });
  kaneoWindow.show();
  kaneoWindow.on('closed', () => {
    kaneoWindow = null;
  });
  return kaneoWindow;
}


// [XG-CUSTOM] AFFiNE 窗口：知识工作台（文档/白板/表格，blocksuite 底座，3010）。
// 设置→集成里 AFFiNE 卡片点「打开」→ 弹出这个窗口。
// 注意：AFFiNE 内容是 Yjs 二进制，进记忆靠 affine_ingest.py（见 Kaneo-OPS.md），与本窗口无关。
let affineWindow: BrowserWindow | null = null;

export function createAffineWindow(url = 'http://127.0.0.1:3010'): BrowserWindow {
  if (affineWindow && !affineWindow.isDestroyed()) {
    affineWindow.show();
    affineWindow.focus();
    return affineWindow;
  }
  affineWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'AFFiNE 知识工作台',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#fcfcfc',
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });
  void affineWindow.loadURL(url);
  affineWindow.once('ready-to-show', () => {
    affineWindow?.show();
    affineWindow?.focus();
  });
  affineWindow.show();
  affineWindow.on('closed', () => {
    affineWindow = null;
  });
  return affineWindow;
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
