/**
 * [XG-CUSTOM 2026-11-05] 握手/就绪**取证日志**（服务端侧）—— 只加日志，不改行为。
 *
 * ## 为什么要有它
 * Windows 客户端连这台 Linux 的 workspace-server 偶发失败（面板 `Workspace Runtime` 停在
 * `Stopped`/`Reconnecting`、客户端反复 `hosts.requestReady`、`hosts.wake reason:"runtime-unavailable"`、
 * `Wire transport disconnected`、`ACP chat bootstrap … Timed out connecting ACP live models`），
 * 而服务端 `journalctl -u workspace-server` **一条都没有** ⇒ 只能从客户端侧猜。
 * 根因是三条链路上的「进了没有 / 谁拒的 / 为什么不给 ready」**全都没有打印点**：
 *   ① 连接建立（accept）与关闭：原来 `socket.on('error')` 是空 handler、close 也不打
 *   ② `initialize` 握手（协议协商成功/被拒）：controller 里 return 了就完事，一个字都不落盘
 *   ③ 每条 RPC 的失败结果：`packages/wire/src/api/serve.ts` 只把失败写回帧，不写日志
 *
 * ## 判据（本模块要能回答的两个问题）
 * - **客户端来问了没有？** ⇒ 每连接一条 `op=session` + `op=initialize`（带 clientId/clientVersion/
 *   protocolVersion/agreedVersion/ms），`msgsIn=0` 就是「连上但一个帧都没发」。
 * - **服务端为什么不给 ready？** ⇒ 失败一律 `phase=error` + `reason`：`closed-before-initialize`
 *   / `closed-without-message` / `initialize-failed` / `protocol-incompatible` / `post-failed`
 *   / `no-ready-session`。
 *
 * ## 日志量纪律（sane 默认）
 * - **成功路径 `debug`**（pino 默认 level=warn ⇒ 默认不出，不刷屏）；`EMDASH_LOG_LEVEL=debug` 才看全。
 * - **失败/异常 `warn`**：失败结果、无 initialize 就断、协议不兼容、回帧失败、就绪掉回未就绪。
 * - 每行都带 `xgwire:"handshake"` 字段，且 `msg` 里含字面量 `xgwire`
 *   ⇒ `journalctl -u workspace-server | grep xgwire` 一行就能抓到。
 * - **不打印任何 body**：只取白名单字段（initialize 的 protocolVersion / client.id / client.appVersion、
 *   `conversationId` 这类稳定标识），其余入参一律不落。
 *
 * 回滚：删掉本文件 + 还原 `wire/serve-socket.ts`、`api/controller.ts`、`index.ts` 三处调用点
 * （每处都有 `[XG-CUSTOM 2026-11-05]` 前缀，`grep -rn 'XG-CUSTOM 2026-11-05' apps/workspace-server/src`）。
 */
import { getCurrentLogger, type Logger } from '@emdash/shared/logger';
import type { WireMessage, WireTransport } from '@emdash/wire/rpc';

/** 所有日志行共有的标记字段：`grep xgwire` / `jq 'select(.xgwire=="handshake")'` 都能抓。 */
export const XG_WIRE_TAG = 'handshake';

export type XgWirePhase = 'enter' | 'ok' | 'error';
export type XgWireLevel = 'debug' | 'info' | 'warn' | 'error';

/** 单字段截断上限：只用于 message/error 文本，避免把整段 body 拖进日志。 */
const MAX_TEXT = 240;
/** 请求 id → 调用信息 的追踪表上限（一个长连接可以做很多次调用，只在结果缺失时才会堆积）。 */
const MAX_TRACKED_IDS = 512;
/** 同一 key 的 warn 去重窗口（毫秒）。 */
const THROTTLE_WINDOW_MS = 10_000;
const MAX_THROTTLE_KEYS = 128;

/**
 * 默认的「握手/就绪」白名单：只有这些 path 的成功结果会打 debug。
 * `hosts.wake` / `hosts.requestReady` 是客户端桌面主进程内部的 wire procedure（renderer→main），
 * **本服务端契约里根本没有**——列在这里是为了「万一客户端真发过来了」能立刻看见
 * （它会以 `UNKNOWN_PROCEDURE` 失败，并被失败日志抓到）。
 */
export const XG_HANDSHAKE_PATHS = [
  'initialize',
  'health',
  'hosts.wake',
  'hosts.requestReady',
] as const;

export type XgWireFields = Record<string, unknown> & { op: string; phase: XgWirePhase };
/** 调用方要给的字段：`phase` 由下面四个 helper 自己决定。 */
export type XgWireEventFields = Record<string, unknown> & { op: string };

function truncate(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…(${value.length}B)` : value;
}

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { xgwire: XG_WIRE_TAG };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    out[key] =
      typeof value === 'string' ? truncate(value) : value instanceof Error ? truncate(value.message) : value;
  }
  return out;
}

/**
 * 唯一落盘点。`msg` 里固定带字面量 `xgwire`，字段里固定带 `xgwire:"handshake"`
 * ⇒ 不论 journald 只显示 msg 还是整行 JSON，grep 都能抓到。
 */
export function xgWire(
  logger: Logger | undefined,
  level: XgWireLevel,
  fields: XgWireFields,
  note?: string
): void {
  const target = logger ?? getCurrentLogger();
  const reason = typeof fields['reason'] === 'string' ? fields['reason'] : undefined;
  const message = `xgwire ${fields.op} ${fields.phase}${reason ? ` (${reason})` : ''}${note ? `: ${note}` : ''}`;
  target[level](message, sanitize(fields));
}

/** 成功/进入态 ⇒ 一律 debug（默认 level=warn 时不输出，避免日志洪水）。 */
export function xgWireEnter(logger: Logger | undefined, fields: XgWireEventFields): void {
  xgWire(logger, 'debug', { ...fields, phase: 'enter' });
}

export function xgWireOk(logger: Logger | undefined, fields: XgWireEventFields): void {
  xgWire(logger, 'debug', { ...fields, phase: 'ok' });
}

/** 失败/异常态 ⇒ 一律 warn。 */
export function xgWireFail(logger: Logger | undefined, fields: XgWireEventFields): void {
  xgWire(logger, 'warn', { ...fields, phase: 'error' });
}

const throttleState = new Map<string, { at: number; suppressed: number }>();

/**
 * 洪水源专用（socket error / 回帧失败）：同 key 在窗口内只 warn 一次，
 * 被压掉的条数在下一次输出时以 `suppressed` 字段补偿 —— 只少打日志，不丢信息。
 */
export function xgWireFailThrottled(
  logger: Logger | undefined,
  key: string,
  windowMs: number,
  fields: XgWireEventFields
): void {
  const now = Date.now();
  const previous = throttleState.get(key);
  if (previous && now - previous.at < windowMs) {
    previous.suppressed += 1;
    return;
  }
  if (throttleState.size > MAX_THROTTLE_KEYS) throttleState.clear();
  const suppressed = previous?.suppressed ?? 0;
  throttleState.set(key, { at: now, suppressed: 0 });
  xgWire(logger, 'warn', {
    ...fields,
    phase: 'error',
    throttledKey: key,
    ...(suppressed > 0 ? { suppressed } : {}),
  });
}

/** 一条连接（= 客户端的一条「候选流」）到目前为止的取证摘要。 */
export type XgSessionSummary = {
  conn: string;
  msgsIn: number;
  msgsOut: number;
  calls: number;
  firstCallPath: string | undefined;
  firstMessageAt: number | undefined;
  lastMessageAt: number | undefined;
  /**
   * **第一次** initialize 的结果。`none` = 这条流从来没发过 initialize
   * （候选流被丢弃 / 客户端握手没走完）。后续重复 initialize 不改这个字段，否则
   * 「先握手成功、后来某次 initialize 失败」会把整条连接误判成没 ready 过。
   */
  initialize: 'none' | 'ok' | 'error';
  /** 这条连接上是否**至少有一次** initialize 成功（就绪计数只认它）。 */
  initializeOk: boolean;
  /** initialize 的尝试次数（重复握手是客户端 bug 的痕迹，值得记）。 */
  initializeAttempts: number;
  clientId: string | undefined;
  clientVersion: string | undefined;
  clientProtocolVersion: string | undefined;
  errorResults: number;
  /** reason(code) → 次数。连接关闭时一行带走，避免每条 CANCELLED 都单独 warn。 */
  errorCodes: Record<string, number>;
  lastErrorPath: string | undefined;
  lastErrorCode: string | undefined;
  lastErrorMessage: string | undefined;
  postFailures: number;
};

export type XgProbeOptions = {
  /** 连接标识（`conn#N`），所有日志行的稳定关联字段。 */
  conn: string;
  logger?: Logger;
  /** 覆盖白名单（默认 `XG_HANDSHAKE_PATHS`）。 */
  handshakePaths?: readonly string[];
  /** initialize 收到时回调一次（不含 body，只回调白名单字段）。 */
  onHello?: (hello: {
    clientId: string | undefined;
    clientVersion: string | undefined;
    clientProtocolVersion: string | undefined;
  }) => void;
  /** initialize 的结果回调一次：ok / error。 */
  onInitializeSettled?: (outcome: 'ok' | 'error', requestId: string) => void;
};

export type XgSessionProbe = {
  transport: WireTransport;
  summary(): XgSessionSummary;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把一条 transport 包一层**只读观察**：消息计数、首帧、initialize、失败结果、回帧失败。
 * 所有方法语义与原来完全一致（`post` 抛错照样抛、`close` 照样关、`onReconnect` 等可选钩子原样透传），
 * 唯一副作用是多打日志。
 */
export function xgProbeTransport(inner: WireTransport, options: XgProbeOptions): XgSessionProbe {
  const handshake = new Set<string>(options.handshakePaths ?? XG_HANDSHAKE_PATHS);
  const logger = options.logger;
  const conn = options.conn;
  const tracked = new Map<string, { path: string; startedAt: number }>();
  const summary: XgSessionSummary = {
    conn,
    msgsIn: 0,
    msgsOut: 0,
    calls: 0,
    firstCallPath: undefined,
    firstMessageAt: undefined,
    lastMessageAt: undefined,
    initialize: 'none',
    initializeOk: false,
    initializeAttempts: 0,
    clientId: undefined,
    clientVersion: undefined,
    clientProtocolVersion: undefined,
    errorResults: 0,
    errorCodes: {},
    lastErrorPath: undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    postFailures: 0,
  };

  function remember(id: string, path: string, startedAt: number): void {
    if (tracked.size >= MAX_TRACKED_IDS) {
      const oldest = tracked.keys().next().value;
      if (oldest !== undefined) tracked.delete(oldest);
    }
    tracked.set(id, { path, startedAt });
  }

  function recordIncoming(message: WireMessage): void {
    summary.msgsIn += 1;
    const now = Date.now();
    summary.firstMessageAt ??= now;
    summary.lastMessageAt = now;

    switch (message.kind) {
      case 'call': {
        summary.calls += 1;
        summary.firstCallPath ??= message.path;
        remember(message.id, message.path, now);
        if (message.path === 'initialize') {
          summary.initializeAttempts += 1;
          const input = message.input as
            | { protocolVersion?: unknown; client?: { id?: unknown; appVersion?: unknown } }
            | undefined;
          summary.clientProtocolVersion = asString(input?.protocolVersion) ?? summary.clientProtocolVersion;
          summary.clientId = asString(input?.client?.id) ?? summary.clientId;
          summary.clientVersion = asString(input?.client?.appVersion) ?? summary.clientVersion;
          options.onHello?.({
            clientId: summary.clientId,
            clientVersion: summary.clientVersion,
            clientProtocolVersion: summary.clientProtocolVersion,
          });
        }
        if (handshake.has(message.path)) {
          xgWireEnter(logger, {
            op: message.path,
            conn,
            reqId: message.id,
            protocolVersion: summary.clientProtocolVersion,
            clientId: summary.clientId,
            clientVersion: summary.clientVersion,
          });
        }
        break;
      }
      case 'snapshot':
      case 'attach': {
        remember(message.id, `${message.kind}(${message.topic})`, now);
        break;
      }
      default:
        break;
    }
  }

  function recordOutgoing(message: WireMessage): void {
    summary.msgsOut += 1;
    if (message.kind !== 'result') return;
    const entry = tracked.get(message.id);
    tracked.delete(message.id);
    const path = entry?.path;
    const ms = entry ? Date.now() - entry.startedAt : undefined;

    if (path === 'initialize') {
      const firstAttempt = summary.initialize === 'none';
      if (firstAttempt) summary.initialize = message.ok ? 'ok' : 'error';
      if (message.ok) summary.initializeOk = true;
      // 只报第一次：就绪计数按「每条连接一次」算，重复 initialize 不会把计数加两次。
      if (firstAttempt) options.onInitializeSettled?.(message.ok ? 'ok' : 'error', message.id);
    }

    if (message.ok) {
      if (path !== undefined && handshake.has(path)) {
        xgWireOk(logger, {
          op: path,
          conn,
          reqId: message.id,
          ms,
          protocolVersion: summary.clientProtocolVersion,
          clientId: summary.clientId,
          clientVersion: summary.clientVersion,
        });
      }
      return;
    }

    // 失败结果：服务端原来**一条都不打**（`serve.ts` 只把错误写回帧），这里是主要取证点。
    summary.errorResults += 1;
    summary.errorCodes[message.code] = (summary.errorCodes[message.code] ?? 0) + 1;
    summary.lastErrorPath = path;
    summary.lastErrorCode = message.code;
    summary.lastErrorMessage = message.message;
    // ⛔ 分级例外：`CANCELLED` / `DISCONNECTED` 是**客户端自己撤的**（断线重连时客户端会把
    // 上百条 attach 一起取消 —— 实测一次重连 40~63 条/分钟），按失败逐条 warn 就是日志洪水，
    // 会把真正的异常埋掉。它们的条数由关闭行里的 `errorCodes` 汇总带走，一条都不丢。
    const clientInitiated = message.code === 'CANCELLED' || message.code === 'DISCONNECTED';
    xgWire(logger, clientInitiated ? 'debug' : 'warn', {
      op: path ?? 'result',
      phase: 'error',
      conn,
      reqId: message.id,
      reason: message.code,
      errorCode: message.code,
      errorMessage: message.message,
      ms,
      clientId: summary.clientId,
      clientVersion: summary.clientVersion,
      protocolVersion: summary.clientProtocolVersion,
    });
  }

  const transport: WireTransport = {
    post(message: WireMessage): void {
      // 先真发；抛错 = 对端已死（`packages/wire/src/api/serve.ts` 的 `tryPost` 会把它吞掉）。
      try {
        inner.post(message);
      } catch (error) {
        summary.postFailures += 1;
        xgWireFailThrottled(logger, `post-failed:${conn}`, THROTTLE_WINDOW_MS, {
          op: 'post',
          reason: 'post-failed',
          conn,
          msgKind: message.kind,
          reqId: 'id' in message ? message.id : undefined,
          errorCode: errorCodeOf(error),
          errorMessage: errorTextOf(error),
          postFailures: summary.postFailures,
        });
        throw error;
      }
      recordOutgoing(message);
    },
    onMessage(cb) {
      return inner.onMessage((message) => {
        recordIncoming(message);
        cb(message);
      });
    },
    onDisconnect(cb) {
      return inner.onDisconnect(cb);
    },
    close() {
      inner.close?.();
    },
  };

  // 可选钩子原样透传（`this` 必须仍是 inner，不能先把方法摘下来再调）。
  if (inner.onReconnect) transport.onReconnect = (cb) => inner.onReconnect!(cb);
  if (inner.onTerminalFailure) transport.onTerminalFailure = (cb) => inner.onTerminalFailure!(cb);

  return {
    transport,
    summary: () => ({ ...summary }),
  };
}
