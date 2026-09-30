// [XG-CUSTOM] 内嵌浏览器 CDP 桥：把 emdash 的 `<webview>` 内嵌浏览器以标准 Chrome DevTools
// Protocol 暴露在 `127.0.0.1:9223`，供 wego-lite/browser_use_bridge.py（agent.py 第②级
// 「iframe 合流」）用 browser-use connect_over_cdp 直连 —— 不改 wego-lite，也不改 agent.py。
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
//   - 只监听 127.0.0.1（不对外网卡暴露；远程/Windows 要连请自己用 socat/ZeroTier 转发 9223）。
//   - 不创建窗口、不 loadURL、不碰 partition / app:// session；只对已绑定的 guest webContents
//     执行 CDP，所以内嵌页自己的 profile 与 emdash 的 app session 不会混。
//   - 不做鉴权（与 Chrome 自带 DevTools 端口一致）：本机任何进程都能操作**内嵌浏览器**，
//     但拿不到主窗口。
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptXiangwoWebSocket, type XiangwoWsConnection } from './xiangwo-cdp-ws';

/** [XG-CUSTOM] 默认端口：与 wego-lite/browser_use_bridge.py 的 `http://localhost:9223` 对齐 */
export const XIANGWO_CDP_DEFAULT_PORT = 9223;

/** [XG-CUSTOM] 只监听回环地址（隔离边界的一部分，别改成 0.0.0.0） */
export const XIANGWO_CDP_HOST = '127.0.0.1';

/** 单条 CDP 命令超时：页面卡死/未加载时快速失败，避免 agent 侧 hang */
export const XIANGWO_CDP_COMMAND_TIMEOUT_MS = 10_000;

/** 目标 URL/标题变化轮询间隔（只在有客户端连着时跑） */
const TARGET_POLL_INTERVAL_MS = 1000;

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
};

export type XiangwoCdpBridgeOptions = {
  /** 白名单来源：已绑定 browserId 的内嵌浏览器（接 browserWebContentsRegistry.listBoundBrowsers） */
  listTargets: () => EmbeddedBrowserTarget[];
  port?: number;
  host?: string;
  commandTimeoutMs?: number;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
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

/** [XG-CUSTOM] 稳定、可预测的 targetId（由 browserId 派生；Chromium 风格大写十六进制） */
export function embeddedTargetId(browserId: string): string {
  return createHash('sha1').update(`xg-embedded:${browserId}`).digest('hex').slice(0, 32).toUpperCase();
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
    this.host = options.host ?? XIANGWO_CDP_HOST;
    this.commandTimeoutMs = options.commandTimeoutMs ?? XIANGWO_CDP_COMMAND_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
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
    const server = createServer((req, res) => this.handleHttp(req, res));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex) => this.handleUpgrade(req, socket));
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
    this.log('内嵌浏览器 CDP 桥已启动', {
      endpoint: this.endpoint,
      hint: 'agent.py 第②级（browser_use_bridge，localhost:9223）连这里',
    });
    return true;
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

  // ── HTTP：/json、/json/list、/json/version（Chrome DevTools 端口最小兼容面）────
  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/json/version') {
      this.writeJson(res, {
        Browser: `Chrome/${process.versions.chrome ?? '0'} (emdash embedded-browser bridge)`,
        'Protocol-Version': '1.3',
        'User-Agent': `emdash-xiangwo-cdp-bridge/${process.versions.electron ?? '0'}`,
        'V8-Version': process.versions.v8 ?? '0',
        'WebKit-Version': '0',
        webSocketDebuggerUrl: this.browserSocketUrl(),
      });
      return;
    }
    if (path === '/json' || path === '/json/list') {
      this.writeJson(res, this.listTargetDescriptors());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'emdash 内嵌浏览器 CDP 桥：只提供 /json、/json/list、/json/version。\n' +
        '只暴露已绑定 browserId 的内嵌浏览器；emdash 主窗口不在其中。\n'
    );
  }

  private writeJson(res: ServerResponse, payload: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  private browserSocketUrl(): string {
    return `ws://${this.host}:${this.port}/devtools/browser/${BROWSER_TARGET_ID}`;
  }

  /** [XG-CUSTOM] 目标清单：每次从白名单现读，URL/标题总是最新 */
  listTargetDescriptors(): Array<Record<string, unknown>> {
    return this.liveTargets().map((target) => {
      const targetId = embeddedTargetId(target.browserId);
      return {
        id: targetId,
        type: 'page',
        title: safeTitle(target.webContents),
        url: safeUrl(target.webContents),
        description: '',
        devtoolsFrontendUrl: `devtools://devtools/bundled/inspector.html?ws=${this.host}:${this.port}/devtools/page/${targetId}`,
        webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/page/${targetId}`,
        browserId: target.browserId,
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
          for (const target of this.liveTargets()) await this.attachAndNotify(client, target, false);
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

  private emitToClient(
    client: Client,
    method: string,
    params: unknown,
    sessionId?: string
  ): void {
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
