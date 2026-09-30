// [XG-CUSTOM] 项我球（orb）/ 旧浮窗的**聊天地址解析**（主进程唯一权威）。
//
// 背景：球面板原来把 8900 写死在渲染进程里（`http://127.0.0.1:8900/v1/chat/completions`）。
// 本机（客户端 == 主机）能通，但 emdash 支持**远程主机**（Windows 客户端 SSH 连这台 Linux
// 主机，agent/8900 跑在主机上），这时 127.0.0.1 是客户端自己 → 必然 `Failed to fetch`。
//
// 所以：渲染进程**不再猜主机**，只问 preload（`electronAPI.resolveXiangwoChatUrl()`），
// 由主进程按下述规则解析（见 resolveXiangwoChatTarget）：
//   1. 环境变量 `XIANGWO_AGENT_URL`（显式覆盖，最高优先级）；
//   2. 没有远程主机（或主机就是 loopback）→ 本机 `http://127.0.0.1:8900`；
//   3. 有远程主机 → 复用 emdash 已有的 **SSH 端口转发**（preview-servers/port-forward-service，
//      WeKnora/T8/OpenViking 窗口用的同一套 `forwardManualPreview`）把主机的 8900 映射到本地；
//   4. 隧道不可用 → 直连主机地址 `http://<host>:8900`（主机侧 8900 监听 0.0.0.0，见 OPS）；
//   5. 连主机地址都拿不到 → 返回"不可达"信号（reachable:false + 人话 hint），URL 仍回落本机；
//   6. **任何异常**都回落本机 127.0.0.1（保持旧行为，绝不让本机坏掉）。
//
// 为什么"当前主机"= 第一条 SSH 连接：emdash 没有全局 activeHost（主机是按 project/task 挂的），
// 而这个 fork 里 WeKnora/T8/OpenViking 的转发窗口已经用 `ssh.manager.getConnectionIds()[0]`
// 这套口径（见 bootstrap/boot/phases/services.ts 的 forwardManualPreview）。球是全局浮窗，
// 沿用同一口径才能和那些窗口"看同一台主机"。
//
// 本模块**不 import electron**（纯逻辑，单测零依赖）：IPC 注册在 main/host/window.ts 里
// 由 wiring 注入真实依赖（见 bootstrap/boot/wiring.ts）。

/** 项我后端（herdr 常驻）在主机上的端口 */
export const XIANGWO_AGENT_PORT = 8900;

/** 本机 8900 的基址（无尾斜杠） */
export const XIANGWO_LOCAL_CHAT_BASE = `http://127.0.0.1:${String(XIANGWO_AGENT_PORT)}`;

/** 解析来源（排查/日志用） */
export type XiangwoChatSource = 'env' | 'local' | 'tunnel' | 'host' | 'fallback';

export type XiangwoChatTarget = {
  /** 完整聊天端点（已带 /v1/chat/completions） */
  url: string;
  /** 基址（无尾斜杠），排查用 */
  baseUrl: string;
  source: XiangwoChatSource;
  /** 是否确定可达；false 时 hint 一定有内容 */
  reachable: boolean;
  /** 不可达时给 UI 的人话提示 */
  hint?: string;
};

export const XIANGWO_UNREACHABLE_HINT =
  '当前是远程主机：8900 只在主机本机可达。请先在主机上开放/转发 8900，或设 XIANGWO_AGENT_URL 指向可达地址。';

/**
 * 依赖注入口（便于单测；wiring 里用真实的 db / SSH 转发实现）。
 * 全部可选：缺失时一律按"没有远程主机"处理 → 回落本机。
 */
export type XiangwoChatTargetDeps = {
  /** 环境变量覆盖（缺省读 process.env.XIANGWO_AGENT_URL） */
  env?: () => string | undefined;
  /** 当前主机候选：emdash 的第一条 SSH 远程连接（无远程主机 → undefined/null） */
  activeRemoteHost?: () => { connectionId: string; host: string } | undefined | null;
  /** 复用 emdash 的 SSH 端口转发，返回本地可访问的基址（失败 → null） */
  forwardRemotePort?: (remotePort: number) => Promise<string | null>;
  /** 隧道等待上限（缺省 5000ms；超时就直连主机地址，绝不让球卡住） */
  tunnelTimeoutMs?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** 缓存 TTL（缺省 60s） */
  cacheTtlMs?: number;
};

/** 去掉尾部斜杠（`http://a:1/` → `http://a:1`） */
export function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * 把"基址 / 半截地址 / 已经是完整端点"的输入统一成 `/v1/chat/completions` 端点。
 * 例：`http://h:8900` → `http://h:8900/v1/chat/completions`；
 *     `http://h:8900/v1` → `http://h:8900/v1/chat/completions`；
 *     `http://h:8900/v1/chat/completions` → 原样。
 */
export function chatCompletionsEndpoint(raw: string): string {
  const base = stripTrailingSlash(raw);
  if (base === '') return `${XIANGWO_LOCAL_CHAT_BASE}/v1/chat/completions`;
  if (/\/v1\/chat\/completions$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** 主机名是不是 loopback（写成本机也一样） */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1') return true;
  return /^127\./.test(value);
}

/**
 * 主机地址能不能当 URL 的 authority 用（拿不到/是垃圾值 → 不能直连，报"不可达"）。
 * `0.0.0.0`/`::` 是"监听所有网卡"的写法，不是可拨号的目标地址。
 */
export function isUsableHostAddress(host: string): boolean {
  const value = host.trim();
  if (value === '' || value === '0.0.0.0' || value === '::') return false;
  if (/\s/.test(value)) return false;
  return /^[A-Za-z0-9._:-]+$/.test(value);
}

function localTarget(source: XiangwoChatSource, reachable: boolean, hint?: string): XiangwoChatTarget {
  return {
    url: `${XIANGWO_LOCAL_CHAT_BASE}/v1/chat/completions`,
    baseUrl: XIANGWO_LOCAL_CHAT_BASE,
    source,
    reachable,
    ...(hint === undefined ? {} : { hint }),
  };
}

function hostTarget(host: string): XiangwoChatTarget {
  // 主机地址可能是 IPv6，加方括号
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const baseUrl = `http://${authority}:${String(XIANGWO_AGENT_PORT)}`;
  return { url: `${baseUrl}/v1/chat/completions`, baseUrl, source: 'host', reachable: true };
}

function targetFromBase(baseUrl: string, source: XiangwoChatSource): XiangwoChatTarget {
  const base = stripTrailingSlash(baseUrl);
  return { url: chatCompletionsEndpoint(base), baseUrl: base, source, reachable: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

/**
 * 纯解析（不缓存、不碰全局）：单测直接调它。
 * 任何异常都回落本机 127.0.0.1（本机行为永不受影响）。
 */
export async function computeXiangwoChatTarget(
  deps: XiangwoChatTargetDeps = {}
): Promise<XiangwoChatTarget> {
  const envValue = (deps.env ?? (() => process.env.XIANGWO_AGENT_URL))();
  if (typeof envValue === 'string' && stripTrailingSlash(envValue) !== '') {
    return targetFromBase(envValue, 'env');
  }
  let host: { connectionId: string; host: string } | undefined | null;
  try {
    host = deps.activeRemoteHost?.() ?? undefined;
  } catch (error) {
    deps.log?.('读取当前主机失败，回落本机', { error: String(error) });
    return localTarget('fallback', true);
  }
  if (host === undefined || host === null) return localTarget('local', true);
  if (isLoopbackHost(host.host)) return localTarget('local', true);

  const forward = deps.forwardRemotePort;
  if (forward !== undefined) {
    try {
      const forwarded = await withTimeout(
        forward(XIANGWO_AGENT_PORT),
        deps.tunnelTimeoutMs ?? 5000
      );
      const base = typeof forwarded === 'string' ? stripTrailingSlash(forwarded) : '';
      if (base !== '') {
        deps.log?.('聊天地址走 SSH 转发', { host: host.host, baseUrl: base });
        return targetFromBase(base, 'tunnel');
      }
    } catch (error) {
      deps.log?.('SSH 转发 8900 失败，改用主机地址直连', {
        host: host.host,
        error: String(error),
      });
    }
  }
  if (isUsableHostAddress(host.host)) {
    deps.log?.('聊天地址直连主机', { host: host.host });
    return hostTarget(host.host);
  }
  deps.log?.('远程主机地址不可用（隧道也不可用）', { host: host.host });
  return localTarget('fallback', false, XIANGWO_UNREACHABLE_HINT);
}

let cached: { at: number; value: XiangwoChatTarget } | undefined;
let inFlight: Promise<XiangwoChatTarget> | undefined;
let configuredDeps: XiangwoChatTargetDeps | undefined;

/** 清缓存（SSH 连接变化 / 单测） */
export function resetXiangwoChatTargetCache(): void {
  cached = undefined;
  inFlight = undefined;
}

/** 注入依赖（wiring 在 boot 时调一次；重复调用会清缓存） */
export function configureXiangwoChatTargetDeps(deps: XiangwoChatTargetDeps): void {
  configuredDeps = deps;
  resetXiangwoChatTargetCache();
}

/**
 * 带缓存 + 并发去重的解析（IPC handler 用）。
 * TTL 内复用同一结果，避免每条消息都重试隧道；任何异常都回落本机。
 */
export async function resolveXiangwoChatTarget(): Promise<XiangwoChatTarget> {
  const deps = configuredDeps ?? {};
  const now = Date.now();
  const ttl = deps.cacheTtlMs ?? 60_000;
  if (cached !== undefined && now - cached.at < ttl) return cached.value;
  if (inFlight !== undefined) return inFlight;
  inFlight = computeXiangwoChatTarget(deps)
    .catch((error: unknown) => {
      deps.log?.('聊天地址解析异常，回落本机', { error: String(error) });
      return localTarget('fallback', true);
    })
    .then((value) => {
      cached = { at: Date.now(), value };
      inFlight = undefined;
      return value;
    });
  return inFlight;
}
