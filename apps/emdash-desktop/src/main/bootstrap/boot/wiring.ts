import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { browserEvents } from '@core/features/browser/node'; // [XG-CUSTOM] 内嵌浏览器「从零开页」广播
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
// [XG-CUSTOM] bot ⟷ 浏览器 profile 绑定表（唯一真源 = botId）
import {
  xiangwoBotIdForBrowserProfile,
  xiangwoBoundProfileIdForBot,
  xiangwoNewBotProfileId,
  xiangwoProfileIdForBot,
} from '@main/host/browser/xiangwo-bot-browser-profile';
import {
  createXiangwoBrowserRelay,
  type XiangwoBrowserRelay,
} from '@main/host/browser/xiangwo-browser-relay';
import {
  XiangwoCdpBridge,
  type XiangwoOpenBrowserRequest,
} from '@main/host/browser/xiangwo-cdp-bridge'; // [XG-CUSTOM]
import {
  parseXiangwoCdpAllowList,
  resolveXiangwoCdpBindMode,
} from '@main/host/browser/xiangwo-cdp-peers';
import { createRelayCandidateSelector } from '@main/host/browser/xiangwo-relay-candidates';
import { createDevPerfOperations } from '@main/host/dev-perf/controller-operations';
import { writeRendererLogEntry } from '@main/host/file-logger';
import { setTrayVisible } from '@main/host/tray';
import { updateOperations } from '@main/host/updates/controller-operations';
import {
  applyNativeTheme,
  createAffineWindow,
  createKaneoWindow,
  createOpenVikingWindow,
  createT8Window,
  createWeKnoraWindow,
  createXiangwoFloatingWindow,
  ensureChromeRunning,
  expertHandoffCall,
  expertRosterCall,
  taskSpaceCall,
} from '@main/host/window'; // [XG-CUSTOM]
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
 * [XG-CUSTOM] 内嵌浏览器 CDP 桥（agent.py 第②级「内嵌浏览器优先」的通道；
 * 历史叫法「iframe 合流」，实际是渲染进程 <webview> + 本桥白名单 CDP，没有 iframe）。
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
    // [XG-CUSTOM] 顺带回报该页所属 profile / bot（botId 由 profile 的绑定反查）
    listTargets: () =>
      browserWebContentsRegistry.listBoundBrowsers().map((target) => ({
        ...target,
        ...(target.profileId === undefined
          ? {}
          : { botId: xiangwoBotIdForBrowserProfile(target.profileId) }),
      })),
    ...(Number.isFinite(configuredPort) && configuredPort > 0 ? { port: configuredPort } : {}),
    bind: resolveXiangwoCdpBindMode(process.env.XIANGWO_CDP_BIND),
    ...(allowedPeers.length > 0 ? { allowedPeers } : {}),
    // [XG-CUSTOM] 「从零开页」：白名单为空时把意图广播给渲染进程（真正开页的是它）
    requestOpenBrowser: requestEmbeddedBrowserOpen,
    // [XG-CUSTOM] bot → 已绑定的 profile（未绑定 null）：挑"要复用的那一页"用
    lookupBotProfile: (botId) => xiangwoBoundProfileIdForBot(botId),
    // [XG-CUSTOM] 未绑定的 bot → 确定性的 `bot-<botId>`（[XG-CUSTOM 2026-10-03]）：桥用它挑页 +
    // 随开页请求下发给渲染进程（渲染进程按同一个 id 真的建出这个 profile），否则 botId 永远带上不去。
    newBotProfileId: (botId) => xiangwoNewBotProfileId(botId),
    log: (message, metadata) => log.info(`[XG-CUSTOM] ${message}`, metadata),
  });
  xiangwoCdpBridge = bridge;
  void bridge.start();
}

/**
 * [XG-CUSTOM] 「从零开页」广播：主进程 → 渲染进程。
 *
 * 内嵌浏览器是渲染进程的 `<webview>`（attach 后才 `bindWebContents` → 才进 9223 白名单）。
 * 所以「一个标签页都没有」时，唯一合规的开页方式就是**请渲染进程开**，而不是主进程自己造
 * WebContentsView（那会绕过 `browser-webcontents-registry.ts` 的 attach 白名单）。
 *
 * 渲染进程侧的消费者：`core/features/workbench/api/browser/embedded-browser-open-request.ts`
 * （挂在 `renderer/App.tsx`）。它只操作**内嵌浏览器**，主窗口永远不在可达范围内。
 *
 * [XG-CUSTOM] bot ⟷ profile：带了 `bot`/`profile` 就**在主进程解析成具体 profileId**
 * （唯一真源 = botId；未绑定的 bot → 设置里的 defaultProfileId），再随事件下发 ——
 * 渲染进程不必自己认识 bot 名册。**都不带 → 事件与改动前逐字节一致**（渲染进程用 defaultProfileId）。
 * [XG-CUSTOM 2026-10-03] `botId` 也一起下发：渲染进程要按它**按需建/复用那个 bot 的 profile**
 * （否则带 botId 开的页落到 default，`/json/list` 里 `profile`/`botId` 永远为空 = agent 分不清
 * "这一页是不是我的"）。
 */
export function requestEmbeddedBrowserOpen(request: XiangwoOpenBrowserRequest): void {
  try {
    const explicitProfile = (request.profile ?? '').trim();
    const bot = (request.bot ?? '').trim();
    const profileId =
      explicitProfile !== '' ? explicitProfile : bot !== '' ? xiangwoProfileIdForBot(bot) : '';
    browserEvents.emit(undefined, {
      type: 'open-in-embedded-browser',
      url: request.url,
      ...(profileId !== '' ? { profileId } : {}),
      ...(bot !== '' ? { botId: bot } : {}),
    });
  } catch (error) {
    log.warn('[XG-CUSTOM] 广播内嵌浏览器开页请求失败', {
      url: request.url,
      error: String(error),
    });
  }
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
 *   本机 127.0.0.1:8900 / SSH 转发 / 主机地址直连）。**显式给了 URL 就无条件拨**。
 * - 自动避让（2026-10-02 修正）：解析出"回环 + 8900"时**不再**直接停用，而是先
 *   `GET {base}/xg/whoami` 比对面 hostname 与本机 `os.hostname()` —— 同机才停用。
 *   原因：SSH 转发（`ssh -L 8900:127.0.0.1:8900`）给出的也是这个地址，旧判据把外地
 *   Windows 误停用（hub 里 `has_peer=false`）。保险丝 `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1`。
 * - 逃生开关：`XIANGWO_BROWSER_RELAY=0` 关；`=1` 开
 * - 失败只打日志 + 指数退避，绝不影响主窗口启动
 * - [XG-CUSTOM 2026-10-02] **多候选 + 自动切换**（`xiangwo-relay-candidates.ts`）：
 *   依次试 `XIANGWO_BROWSER_RELAY_URL` > 上次成功的 > 直连网线 192.168.2.10 > ZeroTier
 *   10.239.5.174 > tailscale 100.125.4.119 > 127.0.0.1，探到就记、坏了就换（5 分钟复检）。
 *   **Windows 端不需要配任何东西**：不设 env 也自己找路、自己切。
 */
export function startXiangwoBrowserRelay(): void {
  if (xiangwoBrowserRelay !== null) return;
  const relayLog = (message: string, metadata?: Record<string, unknown>): void => {
    log.info(`[XG-CUSTOM] ${message}`, metadata);
  };
  // [XG-CUSTOM 2026-10-02] 多候选地址选择器：一条链路断了自动走下一条（不需要重启 emdash）
  const selector = createRelayCandidateSelector({
    log: relayLog,
    // 兜底动态候选（SSH 转发 / 远程主机地址）：静态候选都不通时才轮得到它
    extraCandidates: async () => {
      try {
        const target = await resolveXiangwoChatTarget();
        return target.baseUrl === ''
          ? []
          : [
              {
                url: target.baseUrl,
                source: 'dynamic' as const,
                label: `动态解析（${target.source}）`,
              },
            ];
      } catch {
        return [];
      }
    },
  });
  const relay = createXiangwoBrowserRelay(
    async () => selector.resolve(),
    relayLog,
    // [XG-CUSTOM] 跨机 `open` 命令同样支持「从零开页」（与 9223 桥共用同一套广播）
    requestEmbeddedBrowserOpen,
    // [XG-CUSTOM 2026-10-02] 连续失败 → 判定这条路坏了 → 换下一条
    {
      onBaseUrlFailure: (baseUrl) => selector.noteFailure(baseUrl),
      // [XG-CUSTOM] bot ⟷ profile：跨机开页也挑"这个 bot 自己的那一页"
      lookupBotProfile: (botId) => xiangwoBoundProfileIdForBot(botId),
    }
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
      // [XG-CUSTOM] Kaneo 窗口（项我流程枢纽：工作项/交接/依赖/审计，5180）
      openKaneo: async () => {
        const url = (await services.forwardManualPreview(5180)) ?? 'http://127.0.0.1:5180';
        createKaneoWindow(url);
        return { success: true };
      },
      // [XG-CUSTOM] AFFiNE 窗口（知识工作台：文档/白板/表格，3010）
      openAffine: async () => {
        const url = (await services.forwardManualPreview(3010)) ?? 'http://127.0.0.1:3010';
        createAffineWindow(url);
        return { success: true };
      },
      // [XG-CUSTOM] 专家交接平台：wire RPC → expert_handoff.py（session 隔离版 CLI）
      expertHandoffByExpert: ({ expert }) => expertHandoffCall('by-expert', expert),
      expertHandoffAccept: ({ id }) => expertHandoffCall('accept', id),
      expertHandoffDelete: ({ id }) => expertHandoffCall('delete', id),
      expertHandoffList: ({ bot, session }) => expertHandoffCall('list', bot, session),
      // [XG-CUSTOM] 新建交接（手动写交接内容，让专家接下去做）
      expertHandoffAdd: ({ bot, expert, title, summary, session, context }) =>
        expertHandoffCall('add', bot, expert, title, summary, session, context),
      // [XG-CUSTOM] Pi 树专家名册（专家总览视图）
      expertRoster: () => expertRosterCall(),
      // [XG-CUSTOM] 浏览器工作台（task-spaces）：页面控制权交接（交接台第二个 Tab）
      taskSpaceList: () => taskSpaceCall('list'),
      taskSpaceHandoff: ({ id }) => taskSpaceCall('handoff', id),
      taskSpaceTakeover: ({ id }) => taskSpaceCall('takeover', id),
      taskSpaceComplete: ({ id, keep }) => taskSpaceCall('complete', id, keep ? 'true' : 'false'),
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
