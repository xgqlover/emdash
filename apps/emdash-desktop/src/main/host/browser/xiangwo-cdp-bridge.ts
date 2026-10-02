// [XG-CUSTOM] 内嵌浏览器 CDP 桥：把 emdash 的 `<webview>` 内嵌浏览器以标准 Chrome DevTools
// Protocol 暴露在 `127.0.0.1:9223`，供 wego-lite/browser_use_bridge.py（agent.py 第②级
// 「内嵌浏览器优先」—— 历史叫法「iframe 合流」，实际链路里没有任何 iframe）用 browser-use
// connect_over_cdp 直连 —— 不改 wego-lite，也不改 agent.py。
//
// ── 为什么必须自己开这条通道（实测结论，别再走弯路）────────────────────────────
// 1) emdash 从来没在 9223 上监听任何东西（历史 9223 是 HippoBuddy/electron/main.js 开的，
//    那个进程现在根本不在跑）→ 第②级永远失败落回 9222 真 Chrome。
// 2) 只给 Electron 加 `--remote-debugging-port` **也不行**，两个实测原因：
//    - Electron 把 `<webview>` 报成 CDP target type `webview`；browser-use 的 session_manager
//      靠 `Target.getTargets` 找不到它（实测：能连上 9223，但 `get_tabs()` 里没有内嵌页 →
//      `(没找到含 … 的 webview)`）。
//    - 更危险：调试端口会把**所有**窗口（含主窗口的对话/密钥页）一起暴露，而 browser-use 会
//      主动 `Target.closeTarget` 掉它认为"不在允许域名内"的标签页 —— 实测把我的探针窗口关掉了。
//      主窗口被 agent 关掉不可接受。
// 因此这里在主进程内做一条**白名单 CDP 端点**：
//   - 只 attach 经 `BrowserWebContentsRegistry.bindWebContents` 绑定过的 webContents，
//     也就是"拿得到 browserId 的那个内嵌浏览器"；主窗口/其它 webContents 既不出现在
//     `/json`，也无法用目标 id 附加（attach 返回错误）。
//   - 对外把 target type 统一报成 `page`（洗白），于是浏览器标签页语义在 browser_use 侧成立。
//   - 页面级命令原样转发到 `webContents.debugger`（真 Chromium 实现），不自己造协议。
//   - 每条命令都有超时（默认 10s）：页面没加载/卡死时**快速失败并给人话**，绝不 hang。
//
// 隔离边界（明确写清楚）：
//   - 监听模式由 `XIANGWO_CDP_BIND` 决定，缺省 **auto = 0.0.0.0:9223 + 来源 IP 过滤**：
//     只放行本机回环（127.0.0.0/8、::1）与自动探测到的 ZeroTier/tailscale 组网网段；
//     其它来源在**连接层**直接回 403 并断开（记一条日志，见 handleConnection）。
//     这就是"装完即用"：对面 Linux 上的 agent 直接连 `http://<本机组网IP>:9223`，
//     不需要用户手工 `netsh portproxy` + 防火墙规则。`local` = 只 127.0.0.1；`off` = 不监听。
//     （来源白名单细则/可覆盖项见 xiangwo-cdp-peers.ts）
//   - 不创建窗口、不 loadURL、不碰 partition / app:// session；只对已绑定的 guest webContents
//     执行 CDP，所以内嵌页自己的 profile 与 emdash 的 app session 不会混。
//   - 不做鉴权（与 Chrome 自带 DevTools 端口一致）：**白名单来源内**的任何进程都能操作
//     **内嵌浏览器**，但拿不到主窗口。
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  collectXiangwoCdpAllowedPeers,
  detectDefaultRouteAddress,
  formatAllowedPeers,
  isPeerAllowed,
  preferredRemoteAddress,
  windowsFirewallHint,
  XIANGWO_CDP_ANY_HOST,
  XIANGWO_CDP_LOOPBACK_PEERS,
  type XiangwoCdpAllowedPeer,
  type XiangwoCdpBindMode,
  type XiangwoCdpNetworkInterfaces,
  type XiangwoCdpPeerCollectResult,
} from './xiangwo-cdp-peers';
import { acceptXiangwoWebSocket, type XiangwoWsConnection } from './xiangwo-cdp-ws';

/** [XG-CUSTOM] 默认端口：与 wego-lite/browser_use_bridge.py 的 `http://localhost:9223` 对齐 */
export const XIANGWO_CDP_DEFAULT_PORT = 9223;

/** [XG-CUSTOM] 只监听回环地址（`XIANGWO_CDP_BIND=local`，或 options.host 显式覆盖） */
export const XIANGWO_CDP_HOST = '127.0.0.1';

/** 单条 CDP 命令超时：页面卡死/未加载时快速失败，避免 agent 侧 hang */
export const XIANGWO_CDP_COMMAND_TIMEOUT_MS = 10_000;

/** 目标 URL/标题变化轮询间隔（只在有客户端连着时跑） */
const TARGET_POLL_INTERVAL_MS = 1000;

// ── [XG-CUSTOM] 「从零开页」（agent 请求 emdash 开一个内嵌浏览器页）─────────────
/** 端点路径：agent 侧 `emdash_webview_cdp.py::request_open` 必须与此一致 */
export const XIANGWO_CDP_OPEN_BROWSER_PATH = '/xg/open-browser';
/** 广播后等 `<webview>` attach + 被绑定 + 建 CDP target 的上限 */
export const XIANGWO_CDP_OPEN_BROWSER_WAIT_MS = 12_000;
/** 等待期间的轮询间隔 */
export const XIANGWO_CDP_OPEN_BROWSER_POLL_MS = 150;
/** 请求体上限（只收一个 url，防止别人往这条端点灌数据） */
const OPEN_BROWSER_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * attach 时的准备（焦点模拟 + 输入唤醒）是**尽力而为**的，用更短的超时：
 * 页面不健康时也不能让 agent 的第一次 attach 卡住（最多 3 条命令 × 3s）。
 */
const PREPARE_TIMEOUT_MS = 3000;

const BROWSER_TARGET_ID = 'XG-EMBEDDED-BROWSER';
const DEFAULT_CONTEXT_ID = 'XG-EMBEDDED';

/** Electron `webContents.debugger` 里我们用到的那部分（单测注入假实现） */
export type XiangwoCdpDebugger = {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown>;
  on(
    event: 'message',
    listener: (event: unknown, method: string, params: unknown, sessionId?: string) => void
  ): void;
  on(event: 'detach', listener: (event: unknown, reason: string) => void): void;
};

/** Electron `WebContents` 里我们用到的那部分（单测注入假实现） */
export type XiangwoCdpWebContents = {
  id: number;
  getURL(): string;
  getTitle(): string;
  isDestroyed(): boolean;
  focus(): void;
  close(): void;
  debugger: XiangwoCdpDebugger;
};

export type EmbeddedBrowserTarget = {
  browserId: string;
  webContents: XiangwoCdpWebContents;
  // [XG-CUSTOM] bot ⟷ profile：由注册时的 partition 反推（browser-webcontents-registry.ts）。
  // 桥用它挑"这个 bot 自己的页"（不复用别的 bot 的标签页），并回报给 /json/list。
  profileId?: string;
  /** [XG-CUSTOM] 该 profile 绑定的 bot（未绑定 / 不传 = 与改动前一致） */
  botId?: string;
};

/**
 * [XG-CUSTOM] 「从零开页」请求：`{url}` 是唯一必填项，其余都是**可选**的 bot 维度。
 * 老调用方（agent 只发 `{url}`）行为与改动前逐字节一致。
 */
export type XiangwoOpenBrowserRequest = {
  url: string;
  /** 请求方 bot（来自 `_exec_browser(key=...)` / `XIANGWO_WEBVIEW_BOT`）；不带 = 用缺省 profile */
  bot?: string;
  /** 显式 profile（优先级高于 bot）；不带 = 由渲染进程按 defaultProfileId 决定 */
  profile?: string;
};

/** 只要能读出对端地址的 socket（`net.Socket`/`Duplex` 就长这样；单测可注入任意对象） */
export function peerAddressOfSocket(socket: unknown): string | undefined {
  const value = (socket as { remoteAddress?: unknown } | null | undefined)?.remoteAddress;
  return typeof value === 'string' ? value : undefined;
}

export type XiangwoCdpBridgeOptions = {
  /** 白名单来源：已绑定 browserId 的内嵌浏览器（接 browserWebContentsRegistry.listBoundBrowsers） */
  listTargets: () => EmbeddedBrowserTarget[];
  port?: number;
  host?: string;
  commandTimeoutMs?: number;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
  /**
   * [XG-CUSTOM] 监听模式（缺省 `auto` = 0.0.0.0 + 来源 IP 过滤）。
   * `XIANGWO_CDP_BIND` 的解析在 `resolveXiangwoCdpBindMode`（xiangwo-cdp-peers.ts）。
   */
  bind?: XiangwoCdpBindMode;
  /** [XG-CUSTOM] 允许来源 CIDR 覆盖（`XIANGWO_CDP_ALLOW`，逗号分隔）；空/不传 → 自动探测组网网段 */
  allowedPeers?: readonly string[];
  /** [XG-CUSTOM] 网卡枚举（单测注入；缺省 `os.networkInterfaces()`） */
  networkInterfaces?: () => XiangwoCdpNetworkInterfaces;
  /**
   * [XG-CUSTOM] 取对端地址（缺省 `socket.remoteAddress`）。
   * 单测注入它来模拟「tailscale / ZeroTier / 公网」来源 —— 回环连接没法在真机上伪造源地址。
   */
  peerAddressOf?: (socket: unknown) => string | undefined;
  /**
   * [XG-CUSTOM] 「从零开页」回调：白名单里**一个内嵌浏览器都没有**时，agent 侧要开新页就得
   * 先有人在渲染进程里开出一个 Browser 标签页（那个 `<webview>` attach 后才会被
   * `bindWebContents` 绑定，桥才有 target 可用）。这里只负责把意图广播出去
   * （wiring 接 `browserEvents.emit({type:'open-in-embedded-browser'})`），**不创建窗口、
   * 不 loadURL** —— 真正开页的是渲染进程，边界与既有 9223 白名单完全一致。
   * 不传 = 该端点只做「列已有目标」，不会尝试开新页（老行为）。
   * [XG-CUSTOM] bot/profile 维度：请求里带了就原样带给渲染进程（由它解析成 profileId 并开对应
   * partition 的标签页）；没带 = 与改动前逐字节一致。
   */
  requestOpenBrowser?: (request: XiangwoOpenBrowserRequest) => void;
  /**
   * [XG-CUSTOM] bot → profileId（绑定表；未绑定返回 null）。接
   * `xiangwo-bot-browser-profile.ts::xiangwoProfileIdForBot` 的"只查已绑定"变体，
   * 用来判断"已绑定的 bot 该用哪个 profile"以便挑对要复用的那一页。
   * 不传 = 不做 bot 维度复用判断（老行为）。
   */
  lookupBotProfile?: (botId: string) => string | null;
  /** [XG-CUSTOM] 「从零开页」等待新 target 出现的上限（缺省 12s；0 = 不等，只广播） */
  openBrowserWaitMs?: number;
};

type Attachment = {
  browserId: string;
  webContents: XiangwoCdpWebContents;
  targetId: string;
  browserContextId: string;
  /** 我们的合成 sessionId → 客户端 id */
  pageSessions: Map<string, number>;
  /** Chromium 自己发的子 session（OOPIF 等） */
  childSessions: Set<string>;
  /** prepareAttachment 是否已跑过（焦点模拟 + 输入唤醒） */
  prepared: boolean;
  onMessage: (event: unknown, method: string, params: unknown, sessionId?: string) => void;
  onDetach: (event: unknown, reason: string) => void;
};

type Client = {
  id: number;
  conn: XiangwoWsConnection;
  /** 本客户端持有的合成页面 session */
  sessions: Set<string>;
  /** 直连 `/devtools/page/<id>` 的单页客户端（没有浏览器级握手） */
  directBrowserId: string | null;
};

type CdpFailure = { code: number; message: string };

type CommandOutcome = { result: unknown } | { error: CdpFailure };

function errorResponse(id: unknown, code: number, message: string): Record<string, unknown> {
  return { id: id ?? null, error: { code, message } };
}

function okResponse(id: unknown, result: unknown): Record<string, unknown> {
  return { id: id ?? null, result: result ?? {} };
}

function responseFromOutcome(id: unknown, outcome: CommandOutcome): Record<string, unknown> {
  if ('error' in outcome) return { id: id ?? null, error: outcome.error };
  return { id: id ?? null, result: outcome.result ?? {} };
}

/** [XG-CUSTOM] 读一个小的 JSON 请求体（超过上限/不是 JSON 都抛错，调用方转成人话） */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > OPEN_BROWSER_BODY_LIMIT_BYTES) {
        reject(new Error(`请求体超过 ${String(OPEN_BROWSER_BODY_LIMIT_BYTES)} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', (error: Error) => reject(error));
  });
}

/** [XG-CUSTOM] 稳定、可预测的 targetId（由 browserId 派生；Chromium 风格大写十六进制） */
export function embeddedTargetId(browserId: string): string {
  return createHash('sha1')
    .update(`xg-embedded:${browserId}`)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
}

function newSessionId(): string {
  return `XGSESS${randomBytes(10).toString('hex').toUpperCase()}`;
}

export class XiangwoCdpBridge {
  private readonly listTargets: () => EmbeddedBrowserTarget[];
  private readonly port: number;
  private readonly host: string;
  private readonly commandTimeoutMs: number;
  private readonly log: (message: string, metadata?: Record<string, unknown>) => void;
  private readonly bind: XiangwoCdpBindMode;
  private readonly allowedPeers: readonly string[];
  private readonly networkInterfaces: (() => XiangwoCdpNetworkInterfaces) | null;
  private readonly peerAddressOf: (socket: unknown) => string | undefined;
  /** [XG-CUSTOM] 「从零开页」回调（null = 不支持，端点只列已有目标） */
  private readonly requestOpenBrowser: ((request: XiangwoOpenBrowserRequest) => void) | null;
  /** [XG-CUSTOM] bot → profileId（绑定表；未绑定 null） */
  private readonly lookupBotProfile: ((botId: string) => string | null) | null;
  /** [XG-CUSTOM] 「从零开页」等待新 target 的上限 */
  private readonly openBrowserWaitMs: number;
  /** 实际生效的来源白名单（start() 时算好；连接层每条连接都查它） */
  private peers: readonly XiangwoCdpAllowedPeer[] = XIANGWO_CDP_LOOPBACK_PEERS;
  /** 没带 Host 头的请求（HTTP/1.0）回填 ws 地址用的 authority */
  private advertisedAuthority: string;
  private server: Server | null = null;
  private readonly attachments = new Map<string, Attachment>();
  private readonly clients = new Map<number, Client>();
  private nextClientId = 1;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly lastSeen = new Map<string, { url: string; title: string }>();
  private started = false;

  constructor(options: XiangwoCdpBridgeOptions) {
    this.listTargets = options.listTargets;
    this.port = options.port ?? XIANGWO_CDP_DEFAULT_PORT;
    this.bind = options.bind ?? 'auto';
    this.host = options.host ?? (this.bind === 'local' ? XIANGWO_CDP_HOST : XIANGWO_CDP_ANY_HOST);
    this.commandTimeoutMs = options.commandTimeoutMs ?? XIANGWO_CDP_COMMAND_TIMEOUT_MS;
    this.allowedPeers = options.allowedPeers ?? [];
    this.networkInterfaces = options.networkInterfaces ?? null;
    this.peerAddressOf = options.peerAddressOf ?? peerAddressOfSocket;
    this.requestOpenBrowser = options.requestOpenBrowser ?? null;
    this.lookupBotProfile = options.lookupBotProfile ?? null;
    this.openBrowserWaitMs = options.openBrowserWaitMs ?? XIANGWO_CDP_OPEN_BROWSER_WAIT_MS;
    this.log = options.log ?? (() => {});
    const advertisedHost = this.host === XIANGWO_CDP_ANY_HOST ? XIANGWO_CDP_HOST : this.host;
    this.advertisedAuthority = `${advertisedHost}:${this.port}`;
  }

  /**
   * 白名单里"还活着"的内嵌浏览器。webContents 可能在任何两次调用之间被销毁
   * （用户关标签页/页面崩溃/reload），销毁后必须从目标清单里消失 —— 否则 agent 会看到
   * url 为空的幽灵标签页，attach 时才报错。
   */
  private liveTargets(): EmbeddedBrowserTarget[] {
    return this.listTargets().filter((target) => {
      try {
        return !target.webContents.isDestroyed();
      } catch {
        return false;
      }
    });
  }

  get endpoint(): string {
    return `http://${this.host}:${this.port}`;
  }

  /** 启动 HTTP/WS 端点。绑定失败只打日志返回 false（绝不影响主窗口启动）。 */
  async start(): Promise<boolean> {
    if (this.started) return true;
    if (this.bind === 'off') {
      this.log('内嵌浏览器 CDP 桥已关闭（XIANGWO_CDP_BIND=off；第②级会落回有头 Chrome）');
      return false;
    }

    // 默认路由网卡的地址（UDP connect 本地查表，不发包/不要管理员）：只用于"名字没命中时的
    // 地址兜底"判定（见 xiangwo-cdp-peers.ts）。local 模式不做过滤，不必查。
    const defaultRouteAddress = this.bind === 'local' ? null : await detectDefaultRouteAddress();
    const plan: XiangwoCdpPeerCollectResult =
      this.bind === 'local'
        ? {
            allowed: [...XIANGWO_CDP_LOOPBACK_PEERS],
            virtual: [],
            addresses: [],
            warnings: [],
            notes: [],
            report: [],
            candidates: [],
          }
        : collectXiangwoCdpAllowedPeers({
            ...(this.networkInterfaces ? { interfaces: this.networkInterfaces() } : {}),
            allowOverride: this.allowedPeers,
            defaultRouteAddress,
          });
    this.peers = plan.allowed;
    const preferred = preferredRemoteAddress(plan.addresses);
    const advertisedHost = this.host === XIANGWO_CDP_ANY_HOST ? XIANGWO_CDP_HOST : this.host;
    this.advertisedAuthority = `${preferred ?? advertisedHost}:${this.port}`;

    const server = createServer((req, res) => this.handleHttp(req, res));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex) => this.handleUpgrade(req, socket));
    // 来源过滤放在连接层：HTTP 与 WebSocket 一条路径收口（见 handleConnection）
    server.on('connection', (socket: Duplex) => this.handleConnection(socket));
    const listening = await new Promise<boolean>((resolve) => {
      const onError = (error: Error): void => {
        this.log('内嵌浏览器 CDP 桥监听失败（端口可能被占用，第②级会落回有头 Chrome）', {
          endpoint: this.endpoint,
          error: String(error),
        });
        resolve(false);
      };
      server.once('error', onError);
      server.listen(this.port, this.host, () => {
        server.removeListener('error', onError);
        resolve(true);
      });
    });
    if (!listening) {
      server.close();
      return false;
    }
    this.server = server;
    this.started = true;
    this.logListenBanner(plan);
    return true;
  }

  /**
   * [XG-CUSTOM] 启动横幅：必须让用户/我们一眼看懂"听在哪、谁连得上、远端该填什么地址、
   * 没匹配上的网卡叫什么名字"。成功那行的原文（`[XG-CUSTOM] ` 前缀由 wiring.ts 的 log 包装补上）：
   *   `内嵌浏览器 CDP 桥对外监听 0.0.0.0:9223；允许来源: 127.0.0.1/8, ::1, 10.239.5.0/24(ztu7tmyt7w), 100.64.0.0/10(tailscale0)`
   *
   * 后面还会打：每个网卡的判定明细（名字/地址/掩码/mac/结果）、未匹配的候选网段 +
   * 可直接粘贴的 `XIANGWO_CDP_ALLOW=…` 提示 —— 2026-09-30 真机反馈「Windows 上
   * ZeroTier 来源被拒」时，缺的就是这份明细。
   */
  private logListenBanner(plan: XiangwoCdpPeerCollectResult): void {
    if (this.bind === 'local') {
      this.log(`内嵌浏览器 CDP 桥仅监听 ${this.host}:${this.port}（XIANGWO_CDP_BIND=local）`, {
        allowed: formatAllowedPeers(this.peers),
      });
      return;
    }
    this.log(
      `内嵌浏览器 CDP 桥对外监听 ${this.host}:${this.port}；允许来源: ${formatAllowedPeers(this.peers)}`,
      { endpoint: this.endpoint, allowed: this.peers.map((peer) => peer.cidr) }
    );

    // 网卡清单：命中/未命中分开打，IPv6 只记条数（完整明细在 metadata 里，便于 grep 排障）
    if (plan.report.length > 0) {
      const ipv4Rows = plan.report.filter((entry) => entry.family === 'IPv4');
      const matchedRows = ipv4Rows.filter((entry) => entry.cidr !== undefined);
      const otherRows = ipv4Rows.filter((entry) => entry.cidr === undefined);
      this.log(
        `网卡清单（判定来源白名单用）：IPv4/回环 ${ipv4Rows.length} 条，` +
          `另有 IPv6 ${plan.report.length - ipv4Rows.length} 条已略`,
        { interfaces: plan.report }
      );
      for (const entry of matchedRows) {
        this.log(
          `  命中: ${entry.interfaceName} | ${entry.address}/${entry.netmask} | ` +
            `mac=${entry.mac} | internal=${String(entry.internal)} → ${entry.verdict}`
        );
      }
      if (otherRows.length > 0) {
        const detail = otherRows
          .map(
            (entry) => `${entry.interfaceName}=${entry.address}${entry.internal ? '[回环]' : ''}`
          )
          .join(', ');
        this.log(`  未命中（未进白名单）: ${detail}`);
      }
    }

    for (const warning of plan.warnings) this.log(warning);
    for (const note of plan.notes) this.log(note);

    if (plan.addresses.length > 0) {
      const detail = plan.addresses
        .map((item) => `${item.interfaceName}=${item.address}`)
        .join('、');
      const preferred = preferredRemoteAddress(plan.addresses);
      const authority = preferred !== null ? `${preferred}:${this.port}` : this.advertisedAuthority;
      this.log(
        `探测到的组网地址：${detail} → 远端(/Linux agent)填 ` +
          `XIANGWO_WEBVIEW_CDP_URL=http://${authority}`,
        { addresses: plan.addresses }
      );
    }

    // 名字没命中的候选网段 → 明确给出"该怎么自救"，避免再猜一轮
    if (plan.candidates.length > 0) {
      const detail = plan.candidates
        .map((item) => `${item.interfaceName}=${item.address}(${item.cidr})`)
        .join('、');
      const suggestion = [...new Set(plan.candidates.map((item) => item.cidr))].join(',');
      this.log(`未匹配的候选网段（${plan.candidates.length} 条）：${detail}`);
      this.log(
        `若上面白名单里没有你的组网网段，请设 XIANGWO_CDP_ALLOW=${suggestion} 后重启 emdash`
      );
    } else if (plan.addresses.length === 0) {
      this.log(
        '若上面白名单里没有你的组网网段，请设 XIANGWO_CDP_ALLOW=<你的组网网段> 后重启 emdash'
      );
    }

    const firewall = windowsFirewallHint();
    if (firewall !== null) this.log(firewall);
  }

  /**
   * [XG-CUSTOM] 连接层来源过滤：只放行本机回环 + 组网网段（tailscale / ZeroTier）。
   * 其它来源回一条 HTTP 403（WS 客户端会握手失败）+ 记日志，然后断开 —— 不静默丢包，
   * 便于用户/我们一眼看出"是被拒了"而不是"防火墙拦了/服务没起"。
   */
  private handleConnection(socket: Duplex): void {
    const address = this.peerAddressOf(socket);
    if (isPeerAllowed(address, this.peers)) return;
    this.log(
      '拒绝非本机/非组网来源的 CDP 连接（只放行 127.0.0.1/8、::1 与 ZeroTier/tailscale 网段）',
      {
        remoteAddress: address ?? '(未知)',
        allowed: formatAllowedPeers(this.peers),
      }
    );
    denyPeer(socket, this.peers);
  }

  stop(): void {
    this.stopPolling();
    for (const client of this.clients.values()) client.conn.close(1001, 'bridge stopping');
    this.clients.clear();
    for (const attachment of [...this.attachments.values()]) this.destroyAttachment(attachment);
    this.lastSeen.clear();
    this.server?.close();
    this.server = null;
    this.started = false;
  }

  // ── HTTP：/json、/json/list、/json/version + [XG-CUSTOM] /xg/open-browser ────
  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    // 对外监听时不能把 `ws://0.0.0.0:9223/...` 回给客户端（对面机器连 0.0.0.0 是它自己的回环）。
    // 用请求自带的 Host 头回填：远端从 100.x 连过来就回 100.x，本机连就回 127.0.0.1。
    const authority = this.advertisedAuthorityOf(req);
    if (path === '/json/version') {
      this.writeJson(res, {
        Browser: `Chrome/${process.versions.chrome ?? '0'} (emdash embedded-browser bridge)`,
        'Protocol-Version': '1.3',
        'User-Agent': `emdash-xiangwo-cdp-bridge/${process.versions.electron ?? '0'}`,
        'V8-Version': process.versions.v8 ?? '0',
        'WebKit-Version': '0',
        webSocketDebuggerUrl: `ws://${authority}/devtools/browser/${BROWSER_TARGET_ID}`,
      });
      return;
    }
    if (path === '/json' || path === '/json/list') {
      this.writeJson(res, this.listTargetDescriptors(authority));
      return;
    }
    // [XG-CUSTOM] 从零开页：agent 请求「在 emdash 里开一个内嵌浏览器页」。只广播意图给渲染进程
    // 并等 `<webview>` 被绑定，**桥自己不开窗口/不 loadURL**（边界与白名单一致，见 options 注释）。
    if (path === XIANGWO_CDP_OPEN_BROWSER_PATH) {
      void this.handleOpenBrowserRequest(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `emdash 内嵌浏览器 CDP 桥：只提供 /json、/json/list、/json/version、${XIANGWO_CDP_OPEN_BROWSER_PATH}。\n` +
        '只暴露已绑定 browserId 的内嵌浏览器；emdash 主窗口不在其中。\n'
    );
  }

  /**
   * [XG-CUSTOM] `POST /xg/open-browser` — 把「开一个内嵌浏览器页」这件事从零做成。
   *
   * 与 HippoBuddy 的标记驱动自动开页同源（那边是 `markdown-renderer.js` 扫
   * `[XG-PREVIEW]url[/XG-PREVIEW]` → `filePreview.showBrowser(url)`）：**开页的人必须是前端**，
   * 因为内嵌浏览器是渲染进程的 `<webview>`，主进程这边只有「已绑定」的白名单。
   *
   * 语义（四条，都写死在这里以免调用方各自猜）：
   *   1. **已有内嵌页 → 复用，绝不新开**（返回 `reused:true`）——这是「别重复开页」的唯一判据；
   *      但**带 bot/profile 时只复用 profile 对得上的那一页**（复用别的 bot 的页 = 串登录态）；
   *   2. 一个都没有（或没有对得上的）→ 广播 `open-in-embedded-browser` 给渲染进程，再轮询白名单等它被绑定；
   *   3. 等待超时 / 渲染进程没法开（比如没停在 task 视图）→ `ok:false` + 人话，
   *      调用方（agent）据此落回旧链路，**不静默假装成功**；
   *   4. 请求体没带 bot/profile → 与改动前**逐字节一致**（复用第一个已绑定的页）。
   */
  private async handleOpenBrowserRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url = '';
    let bot = '';
    let profile = '';
    try {
      const body = await readJsonBody(req);
      if (typeof body === 'object' && body !== null) {
        const raw = body as { url?: unknown; bot?: unknown; profile?: unknown };
        if (typeof raw.url === 'string') url = raw.url.trim();
        // [XG-CUSTOM] bot/profile：可选，只接受非空字符串（别把对象/数字带进来当 profileId）
        if (typeof raw.bot === 'string') bot = raw.bot.trim();
        if (typeof raw.profile === 'string') profile = raw.profile.trim();
      }
    } catch (error) {
      this.writeOpenBrowserResult(res, {
        ok: false,
        error: `请求体不是合法 JSON：${String(error)}`,
      });
      return;
    }
    if (url === '' || !/^https?:\/\//i.test(url)) {
      this.writeOpenBrowserResult(res, { ok: false, error: '需要 http(s):// 开头的 url' });
      return;
    }

    // [XG-CUSTOM] bot/profile → 只要带了一个，就必须挑 profile 对得上的页复用，
    // 否则「用 sxsj 的身份打开」会静默接管 babado 已登录的那一页。
    const wantedProfile = this.requestedProfileOf(bot, profile);

    // ① 已有 → 复用（不新开）
    const existing = this.liveTargets();
    const reusable =
      wantedProfile === null
        ? existing[0]
        : existing.find((target) => target.profileId === wantedProfile);
    if (reusable !== undefined) {
      this.writeOpenBrowserResult(res, {
        ok: true,
        reused: true,
        url: safeUrl(reusable.webContents),
        targetId: embeddedTargetId(reusable.browserId),
        ...(reusable.profileId !== undefined ? { profile: reusable.profileId } : {}),
        ...(reusable.botId !== undefined ? { botId: reusable.botId } : {}),
      });
      return;
    }

    // ② 从零开
    if (this.requestOpenBrowser === null) {
      this.writeOpenBrowserResult(res, {
        ok: false,
        error:
          'emdash 侧没有接「从零开页」回调（只列已有目标）→ 请先在 emdash 里开一个 Browser 标签页',
      });
      return;
    }
    const known = new Set(this.liveTargets().map((target) => target.browserId));
    try {
      this.requestOpenBrowser({
        url,
        ...(bot !== '' ? { bot } : {}),
        ...(profile !== '' ? { profile } : {}),
      });
    } catch (error) {
      this.writeOpenBrowserResult(res, { ok: false, error: `广播开页请求失败：${String(error)}` });
      return;
    }
    this.log('内嵌浏览器从零开页：已请求渲染进程开 Browser 标签页', {
      url,
      ...(bot !== '' ? { bot } : {}),
      ...(profile !== '' ? { profile } : {}),
    });
    const appeared = await this.waitForNewTarget(known, this.openBrowserWaitMs, wantedProfile);
    if (appeared === null) {
      this.writeOpenBrowserResult(res, {
        ok: false,
        error:
          `已请求 emdash 开内嵌浏览器，但 ${String(Math.round(this.openBrowserWaitMs / 1000))}s 内` +
          '没有页面被绑定（渲染进程可能没停在 task 视图 / 没有可用的 task）',
      });
      return;
    }
    this.writeOpenBrowserResult(res, {
      ok: true,
      reused: false,
      url: safeUrl(appeared.webContents),
      targetId: embeddedTargetId(appeared.browserId),
      ...(appeared.profileId !== undefined ? { profile: appeared.profileId } : {}),
      ...(appeared.botId !== undefined ? { botId: appeared.botId } : {}),
    });
  }

  /**
   * [XG-CUSTOM] 请求里显式指定的 profile；没指定时按 bot 查 `profiles[].botId`。
   * 返回 `null` = 请求完全没带 bot 维度 → 调用方按老行为（谁先来用谁）。
   *
   * 注意这里**只认显式 profile 与已绑定的 bot**：没有绑定关系的 bot 不去猜 defaultProfileId
   * （那会让"未绑定的 bot"也走 profile 精确匹配分支，多一层行为变化）。渲染进程那边照旧
   * `defaultProfileId` 兜底。
   */
  private requestedProfileOf(bot: string, profile: string): string | null {
    if (profile !== '') return profile;
    if (bot === '') return null;
    const bound = this.lookupBotProfile?.(bot) ?? null;
    return bound;
  }

  /** [XG-CUSTOM] 轮询等一个**新**的已绑定内嵌浏览器出现（150ms 一拍，超时返回 null）。
   *  给了 `wantedProfile` 就只认 profile 对得上的新页（否则等于"随便开了一个页"）。 */
  private async waitForNewTarget(
    known: ReadonlySet<string>,
    waitMs: number,
    wantedProfile: string | null = null
  ): Promise<EmbeddedBrowserTarget | null> {
    const deadline = Date.now() + Math.max(0, waitMs);
    for (;;) {
      const fresh = this.liveTargets().find(
        (target) =>
          !known.has(target.browserId) &&
          (wantedProfile === null || target.profileId === wantedProfile)
      );
      if (fresh !== undefined) return fresh;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, XIANGWO_CDP_OPEN_BROWSER_POLL_MS);
      });
    }
  }

  private writeOpenBrowserResult(res: ServerResponse, payload: Record<string, unknown>): void {
    this.writeJson(res, payload);
  }

  /** 请求里的 authority（`host:port`）；没有 Host 头（HTTP/1.0）时用缺省 */
  private advertisedAuthorityOf(req: IncomingMessage): string {
    const host = req.headers.host;
    if (typeof host === 'string' && host.trim() !== '') return host.trim();
    return this.advertisedAuthority;
  }

  private writeJson(res: ServerResponse, payload: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  /** [XG-CUSTOM] 目标清单：每次从白名单现读，URL/标题总是最新。
   *  [XG-CUSTOM] bot ⟷ profile：顺带回报 `profile` / `botId`（旧字段一个不少 —— 老调用方
   *  （browser-use / agent 的 `_xg_webview_*`）只读 id/url/title/webSocketDebuggerUrl）。 */
  listTargetDescriptors(
    authority: string = this.advertisedAuthority
  ): Array<Record<string, unknown>> {
    return this.liveTargets().map((target) => {
      const targetId = embeddedTargetId(target.browserId);
      return {
        id: targetId,
        type: 'page',
        title: safeTitle(target.webContents),
        url: safeUrl(target.webContents),
        description: '',
        devtoolsFrontendUrl: `devtools://devtools/bundled/inspector.html?ws=${authority}/devtools/page/${targetId}`,
        webSocketDebuggerUrl: `ws://${authority}/devtools/page/${targetId}`,
        browserId: target.browserId,
        // [XG-CUSTOM] bot 维度（未绑定 profile 的页只有 profile，没有 botId）
        profile: target.profileId ?? '',
        botId: target.botId ?? '',
      };
    });
  }

  // ── WS 路由 ──────────────────────────────────────────────────────────────
  private handleUpgrade(req: IncomingMessage, socket: Duplex): void {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const conn = acceptXiangwoWebSocket(req, socket);
    if (!conn) return;

    let directBrowserId: string | null = null;
    if (path.startsWith('/devtools/page/')) {
      const targetId = path.slice('/devtools/page/'.length);
      const found = this.liveTargets().find(
        (target) => embeddedTargetId(target.browserId) === targetId
      );
      if (!found) {
        conn.close(1008, 'unknown target');
        return;
      }
      directBrowserId = found.browserId;
    } else if (!path.startsWith('/devtools/browser/')) {
      conn.close(1008, 'unknown path');
      return;
    }

    const client: Client = {
      id: this.nextClientId,
      conn,
      sessions: new Set(),
      directBrowserId,
    };
    this.nextClientId += 1;
    this.clients.set(client.id, client);
    this.ensurePolling();
    this.log('CDP 客户端已连接', {
      clientId: client.id,
      path,
      direct: directBrowserId !== null,
    });

    conn.onClose(() => {
      this.clients.delete(client.id);
      for (const sessionId of [...client.sessions]) this.releaseSession(sessionId, client.id);
      client.sessions.clear();
      if (this.clients.size === 0) this.stopPolling();
      this.log('CDP 客户端已断开', { clientId: client.id });
    });

    conn.onMessage((data, isBinary) => {
      if (isBinary) return;
      let message: CdpRequest;
      try {
        message = JSON.parse(data.toString('utf8')) as CdpRequest;
      } catch {
        return;
      }
      void this.handleClientMessage(client, message);
    });
  }

  private async handleClientMessage(client: Client, message: CdpRequest): Promise<void> {
    const id = message.id;
    const method = typeof message.method === 'string' ? message.method : '';
    const params = message.params ?? {};
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
    if (method === '') return;

    if (sessionId !== '') {
      const outcome = await this.forwardToSession(sessionId, method, params);
      if (outcome === null) {
        client.conn.sendText(
          JSON.stringify(errorResponse(id, -32001, 'Session with given id not found (xg-cdp)'))
        );
        return;
      }
      client.conn.sendText(JSON.stringify(responseFromOutcome(id, outcome)));
      return;
    }

    if (client.directBrowserId !== null) {
      const outcome = await this.sendToDirectClientTarget(client.directBrowserId, method, params);
      client.conn.sendText(JSON.stringify(responseFromOutcome(id, outcome)));
      return;
    }

    client.conn.sendText(JSON.stringify(await this.handleBrowserLevel(client, id, method, params)));
  }

  private async sendToDirectClientTarget(
    browserId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<CommandOutcome> {
    let attachment = this.attachments.get(browserId);
    if (!attachment) {
      const target = this.liveTargets().find((item) => item.browserId === browserId);
      if (!target) {
        return { error: { code: -32000, message: `内嵌浏览器已关闭（browserId=${browserId}）` } };
      }
      try {
        attachment = this.attachTarget(target);
      } catch (error) {
        return { error: { code: -32000, message: String(error) } };
      }
    }
    await this.prepareAttachment(attachment);
    return this.sendToWebContents(attachment.webContents, method, params);
  }

  private async handleBrowserLevel(
    client: Client,
    id: unknown,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (method) {
      case 'Browser.getVersion': {
        const anyTarget = this.liveTargets()[0];
        if (anyTarget) {
          const outcome = await this.sendToWebContents(anyTarget.webContents, method, params);
          if ('result' in outcome) return okResponse(id, outcome.result);
        }
        return okResponse(id, {
          protocolVersion: '1.3',
          product: `Chrome/${process.versions.chrome ?? '0'}`,
          revision: '',
          userAgent: 'emdash-xiangwo-cdp-bridge',
          jsVersion: process.versions.v8 ?? '',
        });
      }
      case 'Target.getTargets': {
        const targetInfos = this.liveTargets().map((target) => this.targetInfoOf(target));
        return okResponse(id, { targetInfos });
      }
      case 'Target.setDiscoverTargets': {
        for (const targetInfo of this.liveTargets().map((target) => this.targetInfoOf(target))) {
          this.emitToClient(client, 'Target.targetCreated', { targetInfo });
        }
        return okResponse(id, {});
      }
      case 'Target.setAutoAttach': {
        if (params['autoAttach'] !== false) {
          for (const target of this.liveTargets())
            await this.attachAndNotify(client, target, false);
        }
        return okResponse(id, {});
      }
      case 'Target.attachToTarget': {
        const targetId = typeof params['targetId'] === 'string' ? params['targetId'] : '';
        const target = this.liveTargets().find(
          (item) => embeddedTargetId(item.browserId) === targetId
        );
        if (!target) {
          return errorResponse(
            id,
            -32000,
            'No target with given id found (xg-cdp：只暴露已绑定 browserId 的内嵌浏览器，emdash 主窗口不可附加)'
          );
        }
        const sessionId = await this.attachAndNotify(client, target, false);
        if (sessionId === null) {
          return errorResponse(id, -32000, `无法附加到内嵌浏览器 ${target.browserId}`);
        }
        return okResponse(id, { sessionId });
      }
      case 'Target.detachFromTarget': {
        const sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : '';
        this.releaseSession(sessionId, client.id);
        return okResponse(id, {});
      }
      case 'Target.getTargetInfo': {
        const targetId = typeof params['targetId'] === 'string' ? params['targetId'] : '';
        if (targetId === '') {
          return okResponse(id, {
            targetInfo: {
              targetId: BROWSER_TARGET_ID,
              type: 'browser',
              title: 'emdash 内嵌浏览器桥',
              url: '',
              attached: true,
            },
          });
        }
        const target = this.liveTargets().find(
          (item) => embeddedTargetId(item.browserId) === targetId
        );
        if (!target) return errorResponse(id, -32000, 'No target with given id found (xg-cdp)');
        return okResponse(id, { targetInfo: this.targetInfoOf(target) });
      }
      case 'Target.activateTarget': {
        const target = this.targetByTargetId(params['targetId']);
        if (!target) return errorResponse(id, -32000, 'No target with given id found (xg-cdp)');
        try {
          target.webContents.focus();
        } catch (error) {
          this.log('聚焦内嵌浏览器失败', { browserId: target.browserId, error: String(error) });
        }
        return okResponse(id, {});
      }
      case 'Target.closeTarget': {
        const target = this.targetByTargetId(params['targetId']);
        if (!target) return errorResponse(id, -32000, 'No target with given id found (xg-cdp)');
        try {
          target.webContents.close();
          return okResponse(id, { success: true });
        } catch (error) {
          return errorResponse(id, -32000, `关闭内嵌浏览器失败: ${String(error)}`);
        }
      }
      case 'Target.createTarget':
      case 'Target.createBrowserContext':
        // Electron 自己的调试端口对这两个也是这个错（agent 侧会退化成"用当前标签页"）
        return errorResponse(id, -32000, 'Not supported');
      default:
        // 浏览器级未知方法：回空成功（cdp-use 多数忽略返回值），但留日志便于补实现
        this.log('CDP 桥收到未处理的浏览器级方法', { method });
        return okResponse(id, {});
    }
  }

  private targetByTargetId(targetId: unknown): EmbeddedBrowserTarget | undefined {
    if (typeof targetId !== 'string') return undefined;
    return this.liveTargets().find((item) => embeddedTargetId(item.browserId) === targetId);
  }

  private targetInfoOf(target: EmbeddedBrowserTarget): Record<string, unknown> {
    return {
      targetId: embeddedTargetId(target.browserId),
      type: 'page',
      title: safeTitle(target.webContents),
      url: safeUrl(target.webContents),
      attached: this.attachments.has(target.browserId),
      canAccessOpener: false,
      browserContextId:
        this.attachments.get(target.browserId)?.browserContextId ?? DEFAULT_CONTEXT_ID,
    };
  }

  // ── 页面级转发 ────────────────────────────────────────────────────────────
  private async forwardToSession(
    sessionId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<CommandOutcome | null> {
    let attachment: Attachment | undefined;
    for (const candidate of this.attachments.values()) {
      if (candidate.pageSessions.has(sessionId) || candidate.childSessions.has(sessionId)) {
        attachment = candidate;
        break;
      }
    }
    if (!attachment) return null;
    const isChildSession = attachment.childSessions.has(sessionId);
    return this.sendToWebContents(
      attachment.webContents,
      method,
      params,
      isChildSession ? sessionId : undefined
    );
  }

  private async sendToWebContents(
    webContents: XiangwoCdpWebContents,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<CommandOutcome> {
    if (webContents.isDestroyed()) {
      return { error: { code: -32000, message: '内嵌浏览器页面已关闭（xg-cdp）' } };
    }
    try {
      const result = await withTimeout(
        webContents.debugger.sendCommand(method, params, sessionId),
        this.commandTimeoutMs
      );
      return { result };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (message.includes('xg-cdp timeout')) {
        return {
          error: {
            code: -32000,
            message: `${method} 超时（${this.commandTimeoutMs}ms）：内嵌页面可能还没加载完或已卡死`,
          },
        };
      }
      return { error: { code: -32000, message } };
    }
  }

  // ── attach / detach ──────────────────────────────────────────────────────
  private attachTarget(target: EmbeddedBrowserTarget): Attachment {
    const existing = this.attachments.get(target.browserId);
    if (existing && existing.webContents === target.webContents) return existing;
    if (existing) this.destroyAttachment(existing);

    const webContents = target.webContents;
    if (webContents.isDestroyed()) {
      throw new Error('内嵌浏览器页面已关闭');
    }
    try {
      webContents.debugger.attach('1.3');
    } catch (error) {
      throw new Error(
        `无法附加调试器（该内嵌浏览器可能开着开发者工具，或页面刚被关闭）: ${String(error)}`
      );
    }
    const attachment: Attachment = {
      browserId: target.browserId,
      webContents,
      targetId: embeddedTargetId(target.browserId),
      browserContextId: DEFAULT_CONTEXT_ID,
      pageSessions: new Map(),
      childSessions: new Set(),
      prepared: false,
      onMessage: (_event, method, params, sessionId) =>
        this.handleDebuggerMessage(attachment, method, params, sessionId),
      onDetach: (_event, reason) => this.handleDebuggerDetach(attachment, reason),
    };
    webContents.debugger.on('message', attachment.onMessage);
    webContents.debugger.on('detach', attachment.onDetach);
    this.attachments.set(target.browserId, attachment);
    void this.readTargetMeta(attachment);
    this.log('已附加到内嵌浏览器', {
      browserId: target.browserId,
      targetId: attachment.targetId,
    });
    return attachment;
  }

  /**
   * 让渲染进程"以为页面一直是聚焦的"（Playwright 连 CDP 时也会这么做）。
   * 注意：实测**光靠它不够**，冷启动还要靠 warmUpInput 的那次 mouse down。
   */
  private async enableFocusEmulation(attachment: Attachment): Promise<void> {
    try {
      await withTimeout(
        attachment.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
          enabled: true,
        }),
        PREPARE_TIMEOUT_MS
      );
    } catch (error) {
      this.log('开启焦点模拟失败（不影响其它 CDP 命令）', {
        browserId: attachment.browserId,
        error: String(error),
      });
    }
  }

  /**
   * 冷启动"唤醒"输入 —— 这条很关键，不然 agent 的第一次 `fill` 会**静默无效**。
   *
   * 实测症状：刚 attach 的内嵌页还没被真正激活时，Chromium 接受 `Input.dispatchKeyEvent`
   * 并回 `{}`（成功），但页面**一个 keydown 都收不到**，`input.value` 一直是空
   * （页面里记到的只有 `focus` / 清空用的 `input` / `blur`，没有任何键盘事件）。
   * 逐个排查过：`Emulation.setFocusEmulationEnabled`、`Page.bringToFront`、
   * `Input.dispatchMouseEvent{mouseMoved}`、JS `window.focus()` **都没用**；
   * 只有一次真实 mouse **down** 会让 Chromium 走 `RenderWidgetHost::Focus()`，之后键盘才进得去
   * （对照实验：补一次 mouse down 后，下一次按键的值就从 '' 变成 'B'）。
   *
   * 所以 attach 后补一次**屏幕外**（负坐标）的 mouse down/up：负坐标点不到任何元素，
   * 也不会凑成一次 click，对页面是安全的。
   */
  private async warmUpInput(attachment: Attachment): Promise<void> {
    try {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await withTimeout(
          attachment.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type,
            x: -10,
            y: -10,
            button: 'left',
            clickCount: 1,
          }),
          PREPARE_TIMEOUT_MS
        );
      }
    } catch (error) {
      this.log('输入唤醒失败（不影响其它 CDP 命令）', {
        browserId: attachment.browserId,
        error: String(error),
      });
    }
  }

  /** attach 后、把 target 交给客户端之前必须完成的一次性准备（焦点模拟 + 输入唤醒） */
  private async prepareAttachment(attachment: Attachment): Promise<void> {
    if (attachment.prepared) return;
    attachment.prepared = true;
    await this.enableFocusEmulation(attachment);
    await this.warmUpInput(attachment);
  }

  private async readTargetMeta(attachment: Attachment): Promise<void> {
    try {
      const info = (await withTimeout(
        attachment.webContents.debugger.sendCommand('Target.getTargetInfo'),
        this.commandTimeoutMs
      )) as { targetInfo?: { browserContextId?: string } } | undefined;
      const contextId = info?.targetInfo?.browserContextId;
      if (typeof contextId === 'string' && contextId !== '') {
        attachment.browserContextId = contextId;
      }
    } catch {
      // 拿不到就用缺省 browserContextId —— 只影响 attachedToTarget 里的一个字段
    }
  }

  /**
   * attach 并把 attachedToTarget 发给该客户端；返回它拿到的 sessionId。
   * 发事件之前必须 await prepareAttachment —— 否则 browser_use 会在"输入还没被唤醒"的
   * 窗口里就开始打字，第一次 fill 会静默失败（见 warmUpInput 注释）。
   */
  private async attachAndNotify(
    client: Client,
    target: EmbeddedBrowserTarget,
    waitingForDebugger: boolean
  ): Promise<string | null> {
    let attachment: Attachment;
    try {
      attachment = this.attachTarget(target);
    } catch (error) {
      this.log('附加内嵌浏览器失败', {
        browserId: target.browserId,
        error: String(error),
      });
      this.emitToClient(client, 'Target.detachedFromTarget', {
        targetId: embeddedTargetId(target.browserId),
      });
      return null;
    }
    await this.prepareAttachment(attachment);
    const sessionId = newSessionId();
    attachment.pageSessions.set(sessionId, client.id);
    client.sessions.add(sessionId);
    this.emitToClient(
      client,
      'Target.attachedToTarget',
      {
        sessionId,
        targetInfo: {
          targetId: attachment.targetId,
          type: 'page',
          title: safeTitle(attachment.webContents),
          url: safeUrl(attachment.webContents),
          attached: true,
          canAccessOpener: false,
          browserContextId: attachment.browserContextId,
        },
        waitingForDebugger,
      }
      // attachedToTarget 的 sessionId 在 params 里，不作为消息级 sessionId 下发
    );
    this.lastSeen.set(attachment.browserId, {
      url: safeUrl(attachment.webContents),
      title: safeTitle(attachment.webContents),
    });
    return sessionId;
  }

  private releaseSession(sessionId: string, clientId: number): void {
    for (const attachment of [...this.attachments.values()]) {
      if (attachment.pageSessions.get(sessionId) === clientId) {
        attachment.pageSessions.delete(sessionId);
        this.clients.get(clientId)?.sessions.delete(sessionId);
        if (attachment.pageSessions.size === 0 && attachment.childSessions.size === 0) {
          this.destroyAttachment(attachment);
        }
        return;
      }
    }
  }

  private destroyAttachment(attachment: Attachment): void {
    this.attachments.delete(attachment.browserId);
    try {
      attachment.webContents.debugger.detach();
    } catch {
      // 已经 detach / 页面已销毁：忽略
    }
    this.lastSeen.delete(attachment.browserId);
  }

  private handleDebuggerMessage(
    attachment: Attachment,
    method: string,
    params: unknown,
    sessionId?: string
  ): void {
    if (typeof sessionId === 'string' && sessionId !== '') {
      attachment.childSessions.add(sessionId);
      // 子 session（OOPIF 等）带 Chromium 自己的 sessionId，原样下发给所有客户端
      this.broadcast({ method, params, sessionId });
      return;
    }
    // 页面自身事件：按各客户端自己的合成 sessionId 下发
    for (const [synthetic, clientId] of attachment.pageSessions) {
      this.emitToClientById(clientId, method, params, synthetic);
    }
  }

  private handleDebuggerDetach(attachment: Attachment, reason: string): void {
    this.log('内嵌浏览器调试器已脱离', { browserId: attachment.browserId, reason });
    for (const [synthetic, clientId] of attachment.pageSessions) {
      this.emitToClientById(clientId, 'Target.detachedFromTarget', {
        sessionId: synthetic,
        targetId: attachment.targetId,
      });
      this.clients.get(clientId)?.sessions.delete(synthetic);
    }
    attachment.pageSessions.clear();
    attachment.childSessions.clear();
    this.attachments.delete(attachment.browserId);
    this.lastSeen.delete(attachment.browserId);
  }

  private emitToClient(client: Client, method: string, params: unknown, sessionId?: string): void {
    client.conn.sendText(
      JSON.stringify(sessionId === undefined ? { method, params } : { method, params, sessionId })
    );
  }

  private emitToClientById(
    clientId: number,
    method: string,
    params: unknown,
    sessionId?: string
  ): void {
    const client = this.clients.get(clientId);
    if (client) this.emitToClient(client, method, params, sessionId);
  }

  private broadcast(message: Record<string, unknown>): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) client.conn.sendText(payload);
  }

  // ── 目标变化轮询（只在有客户端时跑；1s，开销可忽略）────────────────────────
  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollTargets(), TARGET_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private pollTargets(): void {
    if (this.clients.size === 0) {
      this.stopPolling();
      return;
    }
    const targets = this.liveTargets();
    const alive = new Set<string>();
    for (const target of targets) {
      alive.add(target.browserId);
      if (target.webContents.isDestroyed()) continue;
      const url = safeUrl(target.webContents);
      const title = safeTitle(target.webContents);
      const previous = this.lastSeen.get(target.browserId);
      if (!previous) {
        // 新出现的内嵌浏览器：给所有浏览器级客户端自动 attach（"用户后来才打开浏览器"场景）
        this.lastSeen.set(target.browserId, { url, title });
        for (const client of this.clients.values()) {
          if (client.directBrowserId !== null) continue;
          void this.attachAndNotify(client, target, false);
        }
        continue;
      }
      if (previous.url !== url || previous.title !== title) {
        this.lastSeen.set(target.browserId, { url, title });
        this.broadcast({
          method: 'Target.targetInfoChanged',
          params: { targetInfo: this.targetInfoOf(target) },
        });
      }
    }
    for (const browserId of [...this.lastSeen.keys()]) {
      if (alive.has(browserId)) continue;
      this.lastSeen.delete(browserId);
      this.broadcast({
        method: 'Target.targetDestroyed',
        params: { targetId: embeddedTargetId(browserId) },
      });
    }
  }
}

type CdpRequest = {
  id?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
  sessionId?: unknown;
};

function safeUrl(webContents: XiangwoCdpWebContents): string {
  try {
    return webContents.isDestroyed() ? '' : webContents.getURL();
  } catch {
    return '';
  }
}

function safeTitle(webContents: XiangwoCdpWebContents): string {
  try {
    return webContents.isDestroyed() ? '' : webContents.getTitle();
  } catch {
    return '';
  }
}

/**
 * [XG-CUSTOM] 拒掉一个不在白名单里的来源：回一条 HTTP 403（人话写清允许来源与怎么改），
 * 然后断开。WebSocket 客户端会看到握手失败（连不上），HTTP 客户端能直接读到这句话。
 */
function denyPeer(socket: Duplex, peers: readonly XiangwoCdpAllowedPeer[]): void {
  const body =
    'emdash 内嵌浏览器 CDP 桥：此来源不在允许列表内（只放行本机与 ZeroTier/tailscale 组网网段）。\n' +
    `当前允许来源: ${formatAllowedPeers(peers)}\n` +
    '如需调整：在 emdash 所在机器上设 XIANGWO_CDP_ALLOW=10.0.0.0/24,100.64.0.0/10 后重启 emdash。\n';
  const payload = Buffer.from(body, 'utf8');
  socket.once('error', () => socket.destroy());
  try {
    socket.end(
      `HTTP/1.1 403 Forbidden\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n` +
        `Content-Length: ${payload.length}\r\n` +
        `Connection: close\r\n\r\n` +
        body
    );
  } catch {
    socket.destroy();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`xg-cdp timeout after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
