import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { GitHubAuthServerAdapter } from '@core/features/github/node/accounts/github-auth-server-adapter';
import { getIntegrationConnectionService } from '@core/features/integrations/node/integration-connection-service';
import { provisionWorkspaceErrorToWorkspaceError } from '@core/features/workspaces/node/wire-controller';
import type { DesktopControllerContext } from '@core/manifests/node/controllers';
import { appOperations } from '@main/core/app/controller';
import { terminalFileSources } from '@main/core/app/persist-terminal-attachment';
import {
  createDependencyManagerResolver,
  ensureAgentDependenciesProbed,
} from '@main/core/dependencies/dependency-managers';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import { withCompensation } from '@main/core/utils/compensation';
import { legacyPortOperations } from '@main/db/legacy-port/controller';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { browserOperations } from '@main/host/browser/controller';
import { XiangwoCdpBridge } from '@main/host/browser/xiangwo-cdp-bridge'; // [XG-CUSTOM]
import {
  parseXiangwoCdpAllowList,
  resolveXiangwoCdpBindMode,
} from '@main/host/browser/xiangwo-cdp-peers';
import {
  createXiangwoBrowserRelay,
  type XiangwoBrowserRelay,
} from '@main/host/browser/xiangwo-browser-relay';
import { createDevPerfOperations } from '@main/host/dev-perf/controller-operations';
import { writeRendererLogEntry } from '@main/host/file-logger';
import { setTrayVisible } from '@main/host/tray';
import { updateOperations } from '@main/host/updates/controller-operations';
import { applyNativeTheme, createOpenVikingWindow, createT8Window, createWeKnoraWindow, createXiangwoFloatingWindow, ensureChromeRunning, expertHandoffCall } from '@main/host/window'; // [XG-CUSTOM]
import { resolveXiangwoChatTarget } from '@main/host/xiangwo-chat-target';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { DatabaseBundle } from './phases/database';
import type { ServicesBundle } from './phases/services';

export function wireAccountTelemetry(accountService: EmdashAccountService): void {
  accountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  accountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });
}

export function registerProviderTokenHandlers(): void {
  const githubAuthServerAdapter = new GitHubAuthServerAdapter(getIntegrationConnectionService());
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );
}

export type DesktopControllerOptions = Omit<
  DesktopControllerContext,
  'hosts' | 'runtimes' | 'scope' | 'ssh'
>;

/**
 * [XG-CUSTOM] 项我球（orb）启动常驻：boot 的 window/service 阶段与 wire 注册都完成后，
 * 由 bootBackground（background-tasks 阶段）调一次，把「点了按钮才出现」改成「启动即常驻」。
 *
 * - 逃生开关：XIANGWO_ORB_AUTOSTART=0 时不自动创建（默认创建）。
 * - 延迟一拍，确保主窗口先上屏（不要长延时）。
 * - 失败只打日志：绝不影响主窗口启动。创建本身含「已存在则 show/focus」的复用逻辑，重复调用安全。
 * 球壳/几何/置顶档都在 main/host/xiangwo-orb.ts。
 */
export function autostartXiangwoOrb(delayMs = 1500): void {
  if (process.env.XIANGWO_ORB_AUTOSTART === '0') {
    log.info('[XG-CUSTOM] 项我球自动创建已关闭（XIANGWO_ORB_AUTOSTART=0）');
    return;
  }
  setTimeout(() => {
    try {
      createXiangwoFloatingWindow();
      log.info('[XG-CUSTOM] 项我球已随启动常驻');
    } catch (error) {
      log.warn('[XG-CUSTOM] 项我球自动创建失败（不影响主窗口启动）', { error });
    }
  }, delayMs);
}

/**
 * [XG-CUSTOM] 内嵌浏览器 CDP 桥（agent.py 第②级「iframe 合流」的通道）。
 *
 * wego-lite/browser_use_bridge.py 连的是 `http://localhost:9223`，而 emdash 从没在 9223 上
 * 监听任何东西 —— 这条链路一直是断的。这里在 boot 完成后把桥拉起来：只用
 * `browserWebContentsRegistry.listBoundBrowsers()` 当白名单（拿得到 browserId 的内嵌浏览器），
 * 主窗口/对话页不可附加。
 *
 * - 端口：`XIANGWO_CDP_PORT`（缺省 9223，与 browser_use_bridge 对齐）
 * - 监听模式：`XIANGWO_CDP_BIND` = `auto`（缺省）/`local`/`off`
 *   缺省 auto = 听 `0.0.0.0:9223`（**装完即用**：另一台机器上的 agent 直接连
 *   `http://<本机组网IP>:9223`，不再需要手工 netsh portproxy + 防火墙规则），
 *   但连接层只放行本机回环 + 自动探测到的 ZeroTier/tailscale 组网网段（见 xiangwo-cdp-peers.ts）
 * - 来源白名单覆盖：`XIANGWO_CDP_ALLOW`（逗号分隔 CIDR，例如 `10.239.5.0/24,100.64.0.0/10`），
 *   设了就只用它（+ 本机回环），不再自动探测
 * - 逃生开关：`XIANGWO_CDP_BRIDGE=0`（不启动桥；第②级会像以前一样落回 9222 有头 Chrome）
 * - 失败只打日志：端口被占用/页面异常绝不影响主窗口启动
 */
export function startXiangwoCdpBridge(): void {
  if (['0', 'off', 'false', 'no'].includes((process.env.XIANGWO_CDP_BRIDGE ?? '').toLowerCase())) {
    log.info('[XG-CUSTOM] 内嵌浏览器 CDP 桥已关闭（XIANGWO_CDP_BRIDGE=0）');
    return;
  }
  if (xiangwoCdpBridge !== null) return;
  const configuredPort = Number.parseInt(process.env.XIANGWO_CDP_PORT ?? '', 10);
  const allowedPeers = parseXiangwoCdpAllowList(process.env.XIANGWO_CDP_ALLOW);
  const bridge = new XiangwoCdpBridge({
    listTargets: () => browserWebContentsRegistry.listBoundBrowsers(),
    ...(Number.isFinite(configuredPort) && configuredPort > 0 ? { port: configuredPort } : {}),
    bind: resolveXiangwoCdpBindMode(process.env.XIANGWO_CDP_BIND),
    ...(allowedPeers.length > 0 ? { allowedPeers } : {}),
    log: (message, metadata) => log.info(`[XG-CUSTOM] ${message}`, metadata),
  });
  xiangwoCdpBridge = bridge;
  void bridge.start();
}

let xiangwoCdpBridge: XiangwoCdpBridge | null = null;

/**
 * [XG-CUSTOM] 内嵌浏览器「反向命令通道」：**出站 only**，跨机主路径。
 *
 * 与上面那台 9223 桥的分工（两者都保留，互不冲突）：
 *   · 9223 桥 = **入站**（谁在网内谁来连 `http://<本机>:9223`），本机 agent 与"懒人网段"用它；
 *   · 本通道 = **出站**（emdash 主动拨回 Linux agent 的 8900 长轮询），跨机用它 ——
 *     **对面不需要开任何入站端口、不写防火墙规则、不做来源白名单**（抄 HippoBuddy 的机制）。
 * 执行面完全复用 9223 桥（命令一律转发到 `127.0.0.1:9223`），所以白名单边界不变：
 * 只能操作内嵌浏览器，主窗口永远不可附加。
 *
 * - 地址：`XIANGWO_BROWSER_RELAY_URL` > `resolveXiangwoChatTarget()`（球面板同一套解析：
 *   本机 127.0.0.1:8900 / SSH 转发 / 主机地址直连）
 * - 逃生开关：`XIANGWO_BROWSER_RELAY=0`
 * - 失败只打日志 + 指数退避，绝不影响主窗口启动
 */
export function startXiangwoBrowserRelay(): void {
  if (xiangwoBrowserRelay !== null) return;
  const relay = createXiangwoBrowserRelay(
    async () => (await resolveXiangwoChatTarget()).baseUrl,
    (message, metadata) => log.info(`[XG-CUSTOM] ${message}`, metadata)
  );
  if (relay === null) {
    log.info('[XG-CUSTOM] 内嵌浏览器反向通道已关闭（XIANGWO_BROWSER_RELAY=0）');
    return;
  }
  xiangwoBrowserRelay = relay;
  relay.start();
}

let xiangwoBrowserRelay: XiangwoBrowserRelay | null = null;

export function createDesktopWireOptions(
  database: DatabaseBundle,
  services: ServicesBundle,
  runtimes: DesktopRuntimes
): DesktopControllerOptions {
  const taskService = services.taskService;
  const github = services.github;
  const getDependencyManager = createDependencyManagerResolver(runtimes.clients.hostDependencies);
  return {
    terminalFileSources,
    accountService: services.account,
    agentDependencies: {
      ensureAgentDependenciesProbed,
      getDependencyManager,
    },
    appSettings: database.appSettings,
    automations: services.automations,
    browserOperations,
    compensation: withCompensation,
    db: database.db,
    devPerfOperations: createDevPerfOperations(runtimes),
    editorBuffer: database.editorBuffer,
    github: {
      cliAccountImporter: github.cliImport,
      deviceFlowService: github.deviceFlow,
      repositoryService: github.repositories,
    },
    gitCredentials: services.gitCredentials,
    hostAvailability: runtimes.hostAvailability,
    hostOperations: {
      openExternal: ({ url }) => appOperations.openExternal(url),
      openPath: ({ ref }) => appOperations.openPath(ref),
      openXiangwoFloating: () => {
        createXiangwoFloatingWindow();
        void ensureChromeRunning();
        return { success: true };
      },
      openWeKnora: async () => {
        const url = (await services.forwardManualPreview(9037)) ?? 'http://127.0.0.1:9037';
        createWeKnoraWindow(url);
        return { success: true };
      },
      // [XG-CUSTOM] OpenViking 窗口（照 WeKnora 模板，1933 Studio）
      openOpenViking: async () => {
        const url = (await services.forwardManualPreview(1933)) ?? 'http://127.0.0.1:1933/studio';
        createOpenVikingWindow(url);
        return { success: true };
      },
      openT8: async () => {
        const url = (await services.forwardManualPreview(18766)) ?? 'http://127.0.0.1:18766';
        createT8Window(url);
        return { success: true };
      },
      // [XG-CUSTOM] 专家交接平台：wire RPC → expert_handoff.py（session 隔离版 CLI）
      expertHandoffByExpert: ({ expert }) => expertHandoffCall('by-expert', expert),
      expertHandoffAccept: ({ id }) => expertHandoffCall('accept', id),
      expertHandoffDelete: ({ id }) => expertHandoffCall('delete', id),
      expertHandoffList: ({ bot, session }) => expertHandoffCall('list', bot, session),
      // [XG-CUSTOM] 新建交接（手动写交接内容，让专家接下去做）
      expertHandoffAdd: ({ bot, expert, title, summary, session, context }) => expertHandoffCall('add', bot, expert, title, summary, session, context),
      showWorkspaceItemInFolder: (input) => appOperations.showWorkspaceItemInFolder(input),
      clipboardWriteText: ({ text }) => appOperations.clipboardWriteText(text),
      persistDroppedBlob: (input) => appOperations.persistDroppedBlob(input),
      persistClipboardImage: () => appOperations.persistClipboardImage(),
      showTerminalContextMenu: (input) => appOperations.showTerminalContextMenu(input),
      setMenuKeybindings: (input) => appOperations.setMenuKeybindings(input),
      quit: () => appOperations.quit(),
      resolveQuitConfirmation: (input) => appOperations.resolveQuitConfirmation(input),
      ackShutdownFlush: () => appOperations.ackShutdownFlush(),
      shutdownReady: () => appOperations.shutdownReady(),
      openIn: (input) => appOperations.openIn(input),
      checkInstalledApps: () => appOperations.checkInstalledApps(),
      listInstalledFonts: (input) => appOperations.listInstalledFonts(input),
      openSelectDirectoryDialog: (input) => appOperations.openSelectDirectoryDialog(input),
      openSelectAudioFileDialog: (input) => appOperations.openSelectAudioFileDialog(input),
      saveTextFile: (input) => appOperations.saveTextFile(input),
      readAudioFileDataUrl: ({ filePath }) => appOperations.readAudioFileDataUrl(filePath),
      minimizeWindow: () => appOperations.minimizeWindow(),
      toggleMaximizeWindow: () => appOperations.toggleMaximizeWindow(),
      closeWindow: () => appOperations.closeWindow(),
      isWindowMaximized: () => appOperations.isWindowMaximized(),
      getAppVersion: () => appOperations.getAppVersion(),
      getElectronVersion: () => appOperations.getElectronVersion(),
      getPlatform: () => appOperations.getPlatform(),
      getPlatformDisplayName: () => appOperations.getPlatformDisplayName(),
      getDiagnosticLogAttachment: () => appOperations.getDiagnosticLogAttachment(),
      submitFeedback: (input) => appOperations.submitFeedback(input),
    },
    hostIsReachable: services.hostIsReachable,
    issueProviders: services.issueProviders,
    legacyPortOperations,
    logger: log,
    loggingOperations: {
      writeRendererLog: (input) => writeRendererLogEntry(input),
    },
    notifications: services.notifications,
    previewServerAccess: services.previewServerAccess,
    projectDeletion: services.projectDeletion,
    promptLibrary: services.promptLibrary,
    projects: services.projects,
    projectSettings: services.projectSettings,
    providerSettings: services.providerSettings,
    reconcileSweep: services.reconcileSweep,
    search: services.search,
    sessionLaunchContexts: services.sessionLaunchContexts,
    runtimeClients: {
      getMementosRuntimeClient: async () => runtimes.clients.mementos,
      getPullRequestsRuntimeClient: async () => runtimes.clients.pullRequests,
    },
    settingsRuntime: {
      setKeyboardSettings: (settings) => browserWebContentsRegistry.setKeyboardSettings(settings),
      setBrowserSettings: setBrowserCorsRelaxationSettings,
      setTheme: applyNativeTheme,
      setTrayVisible,
    },
    telemetry: telemetryService,
    taskService,
    taskSessions: services.taskSessions,
    terminalShell: {
      getColorEnv: getTerminalColorEnv,
    },
    updateOperations,
    workspaceIdentity: database.workspaceIdentity,
    workspacePlacement: services.workspacePlacement,
    workspaces: {
      async provisionTask(taskId, signal) {
        const result = await taskService.provisionWorkspace(taskId, signal);
        return result.success
          ? result
          : { success: false, error: provisionWorkspaceErrorToWorkspaceError(result.error) };
      },
      reprovisionWorkspace: (workspaceId, options) =>
        taskService.reprovisionWorkspace(workspaceId, options),
    },
  };
}
