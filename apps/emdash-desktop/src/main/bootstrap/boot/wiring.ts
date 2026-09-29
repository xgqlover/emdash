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
import { createDevPerfOperations } from '@main/host/dev-perf/controller-operations';
import { writeRendererLogEntry } from '@main/host/file-logger';
import { setTrayVisible } from '@main/host/tray';
import { updateOperations } from '@main/host/updates/controller-operations';
import { applyNativeTheme, createOpenVikingWindow, createT8Window, createWeKnoraWindow, createXiangwoFloatingWindow, ensureChromeRunning, expertHandoffCall } from '@main/host/window';
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
