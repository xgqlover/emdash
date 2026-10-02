// [XG-CUSTOM] 内嵌浏览器「反向命令通道」客户端（Windows/Linux 都跑，出站 only）。
//
// ── 为什么要有它（HippoBuddy 机制的事实 + 我们要抄的核心）────────────────────────
// HippoBuddy 在 Windows 上能「Linux 端说打开网页 → Windows 打开并同步」，靠的是**只做出站连接**：
//   · Windows 侧 HippoBuddy 主动连 Linux 的模型服务（`config-远程项我.yaml` 的 base_url）
//   · 命令搭在**这条既有出站连接的响应体**里（`[XG-PREVIEW]url[/XG-PREVIEW]` 标记，
//     见 HippoBuddy/src/main/resources/static/js/markdown-renderer.js:206）
//   ⇒ 不需要在 Windows 上开入站端口、不写防火墙规则、不做来源白名单。
//
// 本模块把同一件事做成**双向可用**：emdash 主进程启动时向 Linux agent 的 8900
// （就是它本来就在连的那个地址，见 main/host/xiangwo-chat-target.ts）发一条**长轮询**，
// 收到命令 → 在本机执行 → 结果沿同一条出站通道回传。
//
// ── 为什么是长轮询而不是 WSS ───────────────────────────────────────────────────
// 长轮询只需要 `fetch`（Electron 主进程原生有），**不引入任何新依赖**，穿 HTTP 代理/NAT 最稳；
// 单条命令的往返延迟 = 对面 poll 的驻留时间（几乎为 0，对面一直挂在 poll 里）。
// HippoBuddy 的 `[XG-PREVIEW]` 标记通路本质也是 HTTP。
//
// ── 执行边界（和 9223 桥逐字一致，绝不放大）─────────────────────────────────────
// 命令**全部**转发给本机 `127.0.0.1:9223`（xiangwo-cdp-bridge.ts）。那里只 attach 经
// `BrowserWebContentsRegistry.bindWebContents` 绑定过的**内嵌浏览器**；主窗口/对话页
// 既不出现在 `/json`，也无法按 target id 附加。所以本通道最坏情况也只能操作内嵌浏览器。
// 本模块**自己不开监听、不碰 webContents**，只做"出站拨号 + 本地回环转发"。
//
// ── 失败行为 ─────────────────────────────────────────────────────────────────
// 对面没起 / 网不通 / 地址解析不出来 → 指数退避（1s→2s→5s→15s 封顶）重试，只打日志，
// 绝不影响主窗口启动，也绝不 hang（每次 fetch 都带 AbortSignal.timeout）。
//
// 开关（都不设 = 默认启用，因为它是跨机主路径）：
//   XIANGWO_BROWSER_RELAY=0            关闭（回到"只靠本机 9223"）
//   XIANGWO_BROWSER_RELAY_URL=...      显式指定 Linux agent 基址（**设了就无条件拨**，见下）
//   XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1  强制"本机就是 agent"→ 停用（只有家里 Linux 那台才该设）
//   XIANGWO_EMDASH_RELAY_TOKEN=...     静态 token（两端设同一个；不设 = 不校验）
//   XIANGWO_BROWSER_RELAY_WAIT=25      长轮询单次挂起秒数（缺省 25）
//   XIANGWO_EMDASH_CDP_BASE=...        本机 CDP 基址覆盖（缺省 http://127.0.0.1:9223，单测用）
//
// ── 什么时候会"自我停用"（2026-10-02 修正）────────────────────────────────────
// 只可能是"**确证**目标 8900 就是本机自己那一个 agent 进程"时（`/xg/whoami` 报的 hostname
// == 本机 os.hostname()），或者显式设了 SKIP_LOCAL_AGENT=1。
// **不再**仅凭"地址是回环 + 端口正好 8900"就停用：SSH 转发（`ssh -L 8900:127.0.0.1:8900`）
// 给出的也正是这个地址，两者从 URL 上完全一样 —— 旧判据会把"外地 Windows"误停用，
// 真机实测（Windows 192.168.2.20 ↔ Linux hub 192.168.2.10）就是踩了这个。
import { randomUUID } from 'node:crypto';
import { hostname as osHostname } from 'node:os';

/** [XG-CUSTOM] 默认：命令一律落到本机 9223 白名单桥 */
export const XIANGWO_RELAY_LOCAL_CDP_BASE = 'http://127.0.0.1:9223';
/** [XG-CUSTOM] 缺省长轮询挂起秒数（服务端上限 25s） */
export const XIANGWO_RELAY_DEFAULT_WAIT_SECONDS = 25;
/** [XG-CUSTOM] `open` 命令「从零开页」等待新 target 的上限 */
export const XIANGWO_RELAY_OPEN_BROWSER_WAIT_MS = 12_000;
/** [XG-CUSTOM] 「从零开页」轮询间隔 */
const XIANGWO_RELAY_OPEN_BROWSER_POLL_MS = 150;
/** [XG-CUSTOM] 退避阶梯（网络不通时不要刷屏/不要耗电） */
const BACKOFF_STEPS_MS = [1000, 2000, 5000, 15000];
/** 单条 WS 打开超时 / 单次 CDP 往返超时 */
const WS_OPEN_TIMEOUT_MS = 8000;
const CDP_ONCE_TIMEOUT_MS = 8000;

/** 与浏览器 `WebSocket` 兼容的最小子集（单测注入假的） */
export type RelayWebSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export type RelayCommand = {
  id: number;
  kind: string;
  [key: string]: unknown;
};

export type XiangwoBrowserRelayOptions = {
  /** Linux agent 基址（无尾斜杠），例如 http://10.239.5.174:8900 */
  resolveBaseUrl: () => Promise<string | null>;
  /** 本机 CDP 基址（缺省 http://127.0.0.1:9223） */
  localCdpBase?: string;
  /** 长轮询挂起秒数（缺省 25） */
  pollWaitSeconds?: number;
  /** 静态 token（缺省读 XIANGWO_EMDASH_RELAY_TOKEN） */
  token?: string;
  /** 注入点（单测）：fetch / WebSocket 构造器 / 日志 / 时钟 */
  fetchImpl?: typeof fetch;
  webSocketFactory?: (url: string) => RelayWebSocket;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
  /** 退避阶梯覆盖（单测用；缺省 1s→2s→5s→15s） */
  backoffStepsMs?: readonly number[];
  /**
   * 解析出的基址是"本机 8900"时**要不要做避让判定**（缺省 true）。
   * 只有**自动解析**（没显式给 XIANGWO_BROWSER_RELAY_URL）时才该为 true —— 见 createXiangwoBrowserRelay。
   * 注意：true ≠ 一定停用；真正的结论由 `decideSkipLocalAgent()`（身份探测）给。
   */
  skipLocalAgentBase?: boolean;
  /** 显式 `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1` → 无条件停用（家里 Linux 的保险丝） */
  forceSkipLocalAgent?: boolean;
  /** 显式给了地址（`XIANGWO_BROWSER_RELAY_URL`）→ 无条件拨，不做任何避让判断 */
  explicitTarget?: boolean;
  /** [XG-CUSTOM 2026-10-02] 身份探测注入点（单测）；缺省真去 GET `{base}/xg/whoami` */
  probeHostname?: (baseUrl: string) => Promise<string | null>;
  /** [XG-CUSTOM 2026-10-02] 本机主机名覆盖（单测/真机自测模拟另一台机器）；缺省 `os.hostname()` */
  localHostname?: string;
  /**
   * [XG-CUSTOM] 「从零开页」回调（与 `xiangwo-cdp-bridge.ts` 同名选项同一件事）：
   * 本机一个已绑定的内嵌浏览器都没有时，请**渲染进程**开一个 Browser 标签页。
   * 不传 = `open` 命令保持老行为（只报一句"先在 emdash 主窗口开一个浏览器标签"）。
   */
  requestOpenBrowser?: (url: string) => void;
  /** [XG-CUSTOM] 「从零开页」等待新 target 的上限（缺省 12s） */
  openBrowserWaitMs?: number;
  /**
   * [XG-CUSTOM 2026-10-02] **多候选切换钩子**：这条路的请求失败时被调用；
   * 返回 true = "判定该换路了" → 主循环清掉 `baseUrl` 让下一次循环**重新解析**
   * （`resolveBaseUrl` 那边换成 `RelayCandidateSelector.resolve`，于是自动走到下一条候选）。
   *
   * 不传 = 完全保持旧行为（一个地址用到死，只退避重试）。见 `xiangwo-relay-candidates.ts`。
   */
  onBaseUrlFailure?: (baseUrl: string) => boolean;
};

type RelaySession = {
  sid: string;
  ws: RelayWebSocket;
  buffer: string[];
  flushing: boolean;
  closed: boolean;
};

export type XiangwoBrowserRelayStatus = {
  enabled: boolean;
  baseUrl: string;
  peerId: string;
  parked: boolean;
  commands: number;
  errors: number;
  sessions: number;
  lastError: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseWaitSeconds(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) return XIANGWO_RELAY_DEFAULT_WAIT_SECONDS;
  return Math.min(value, XIANGWO_RELAY_DEFAULT_WAIT_SECONDS);
}

/** 开关：显式 0/off/false/no = 关闭；其它（含未设）= 开启 */
export function relayEnabledFromEnv(raw: string | undefined): boolean {
  return !['0', 'off', 'false', 'no'].includes((raw ?? '').trim().toLowerCase());
}

/** 真值解析：`1/on/true/yes` = 真（用于各个 `...=1` 强制开关） */
export function envTruthy(raw: string | undefined): boolean {
  return ['1', 'on', 'true', 'yes'].includes((raw ?? '').trim().toLowerCase());
}

/**
 * [XG-CUSTOM 2026-10-02] 强制"本机就是 agent"（自我停用）。**只有家里那台 Linux 该设**。
 * 用途：万一身份探测不可用（对端 8900 是旧版、没有 `/xg/whoami`），Linux 上又需要
 * 100% 保证不拨回来 —— 设 `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1` 即可。
 */
export function relaySkipLocalAgentFromEnv(raw: string | undefined): boolean {
  return envTruthy(raw);
}

/** 规范化主机名（大小写/FQDN 尾点/首尾空白都不算差异） */
export function normalizeHostname(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

/**
 * [XG-CUSTOM 2026-10-02] 这个地址是不是"agent 就在**本机**"（用于决定不拨）。
 *
 * 为什么不能只看 URL：家里那台 Linux 上 agent(8900) 与 emdash(9223) 同机，那台 emdash
 * 的 relay 若也拨回来，会和 Windows 抢"被操作的浏览器"（agent 侧反复强调的"错浏览器"坑），
 * 还白多一跳。**但**外地 Windows 用 SSH 转发时拿到的也是 `127.0.0.1:8900`
 * （`ssh -L 8900:127.0.0.1:8900`）—— 只按 URL 判会把 Windows 误停用（真机实测踩到）。
 *
 * 所以这里只判"**像是**本机"（回环 + 8900）；最终要不要停用必须由
 * `decideSkipLocalAgent()` 拿到对面 `/xg/whoami` 的 hostname 才能定。
 */
/** 端口缺省时按协议补（单测用固定回环端口直接调，不依赖真的占用 8900） */
export function isLoopbackAgentBase(baseUrl: string, agentPort = '8900'): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
    return loopback && url.port === agentPort;
  } catch {
    return false;
  }
}

/** `GET {base}/xg/whoami` 的应答（缺字段都当"不知道"） */
export type AgentIdentity = {
  hostname: string;
  instanceId: string;
  platform: string;
};

/**
 * [XG-CUSTOM 2026-10-02] 探测"这个 8900 是哪台机器上的 agent"。
 *
 * 拿到的是**对端进程自己报的** hostname（hub 侧 `socket.gethostname()`，见
 * `xiangwo-agent/emdash_browser_hub.py:build_whoami`）。对面没这个端点（旧版 hub）/
 * 拿不到 hostname / 超时 → null = "不知道"，调用方按"照拨"处理（详情见 decideSkipLocalAgent）。
 */
export async function probeAgentIdentity(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000
): Promise<AgentIdentity | null> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (base === '') return null;
  try {
    const response = await fetchImpl(`${base}/xg/whoami`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    const record = data as Record<string, unknown>;
    return {
      hostname: typeof record.hostname === 'string' ? record.hostname : '',
      instanceId: typeof record.instance_id === 'string' ? record.instance_id : '',
      platform: typeof record.platform === 'string' ? record.platform : '',
    };
  } catch {
    return null;
  }
}

/** `decideSkipLocalAgent()` 的输入（全可选，缺省读环境/真实探测——单测直接给值） */
export type SkipLocalAgentInput = {
  /** 解析出来的基址（缺省由调用方先 resolve） */
  baseUrl: string;
  /** 本机主机名（缺省 `os.hostname()`） */
  localHostname?: string;
  /** 探测结果（缺省真去 GET /xg/whoami） */
  probe?: () => Promise<AgentIdentity | null>;
  /** 显式 `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT` */
  forceSkip?: boolean;
  /** 显式给了 `XIANGWO_BROWSER_RELAY_URL` → 无条件拨（不再做任何避让判断） */
  explicitTarget?: boolean;
  /** agent 端口（缺省 8900；单测用它把"回环+8900"搬到临时端口上验，避免和真 agent 抢端口） */
  agentPort?: string;
  log?: (message: string) => void;
};

/** 决策：true = 自我停用（不拨） */
export type SkipLocalAgentDecision = {
  skip: boolean;
  reason: 'forced' | 'same-host' | 'remote-agent' | 'unknown-agent' | 'not-loopback' | 'explicit';
  /** 给人看的一句话（日志/排查） */
  detail: string;
};

/**
 * [XG-CUSTOM 2026-10-02] 最终判定："要不要因为'agent 就在本机'而自我停用"。
 *
 * 优先级（从高到低）：
 *   1. 显式 `XIANGWO_BROWSER_RELAY_URL` → **绝不**停用（用户手写的地址最大）；
 *   2. `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1` → 停用（家里 Linux 的保险丝）；
 *   3. 地址不是"回环 + 8900" → 不停用（本来就不是这回事）；
 *   4. `/xg/whoami` 报的 hostname == 本机 hostname → **确证同机** → 停用；
 *   5. 报的 hostname ≠ 本机 → **确证转发**（远端 agent）→ 拨；
 *   6. 探测不到 / 对面没这个端点 / hostname 为空 → **照拨**。
 *      取舍说明：情形 6 里"本机真 agent + 旧 hub"会多拨一次，代价是那个 agent 多一个空白
 *      peer（它自己 127.0.0.1 → 自己，长轮询空转，不碰浏览器）；反过来的代价是 Windows 的
 *      跨机主路径**永久死**（就是本次真机 bug 的现象）。两害相权，宁可多拨。
 *      要恢复"旧 hub 也绝不误拨"，在 Linux 上设 `XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1`。
 */
export async function decideSkipLocalAgent(
  input: SkipLocalAgentInput
): Promise<SkipLocalAgentDecision> {
  if (input.explicitTarget === true) {
    return { skip: false, reason: 'explicit', detail: '显式指定了 XIANGWO_BROWSER_RELAY_URL' };
  }
  if (input.forceSkip === true) {
    return { skip: true, reason: 'forced', detail: '设了 XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1' };
  }
  if (!isLoopbackAgentBase(input.baseUrl, input.agentPort ?? '8900')) {
    return { skip: false, reason: 'not-loopback', detail: '地址不是回环 8900' };
  }
  const probe =
    input.probe ??
    ((() => probeAgentIdentity(input.baseUrl)) as () => Promise<AgentIdentity | null>);
  let identity: AgentIdentity | null = null;
  try {
    identity = await probe();
  } catch {
    identity = null;
  }
  const remoteHost = normalizeHostname(identity?.hostname);
  const localHost = normalizeHostname(input.localHostname ?? osHostname());
  if (remoteHost !== '' && remoteHost === localHost) {
    return {
      skip: true,
      reason: 'same-host',
      detail: `对面 /xg/whoami 报 hostname=${remoteHost}，与本机同名 → agent 就在本机`,
    };
  }
  if (remoteHost !== '') {
    return {
      skip: false,
      reason: 'remote-agent',
      detail:
        `对面 /xg/whoami 报 hostname=${remoteHost}，本机是 ${localHost} → ` +
        '这是 SSH 转发过来的远端 agent（回环地址不等于同机）',
    };
  }
  return {
    skip: false,
    reason: 'unknown-agent',
    detail:
      '对面 8900 没答 /xg/whoami（旧版 agent？）→ 无法确证同机，按"远端"照拨；' +
      '要强制停用请设 XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT=1',
  };
}

/** `http://127.0.0.1:9223` → `ws://127.0.0.1:9223`（端口缺省补 9223） */
export function localWsBaseOf(localCdpBase: string): string {
  try {
    const url = new URL(localCdpBase);
    const port = url.port !== '' ? url.port : '9223';
    return `ws://${url.hostname}:${port}`;
  } catch {
    return 'ws://127.0.0.1:9223';
  }
}

/**
 * [XG-CUSTOM 2026-10-02 移除] 旧判据 `isLocalAgentBase(baseUrl)`：只看"回环 + 端口 8900"。
 *
 * 它的错在注释里就写着 ——「SSH 转发场景下 Windows 拿到的也是回环地址，但端口不是 8900」。
 * 这个前提在真机上不成立：`ssh -L 8900:127.0.0.1:8900`（用户那台 Win 就是这么转的）给出的
 * 正是 `http://127.0.0.1:8900`，于是 Windows 被当成"本机有 agent"→ relay 自我停用 → hub 里
 * 永远看不到它（`has_peer=false`）。现在改成 `isLoopbackAgentBase()`（只判"像"，不判"是"）
 * + `decideSkipLocalAgent()`（用 /xg/whoami 的 hostname 确证）。
 *
 * @deprecated 语义已被 `isLoopbackAgentBase()` 取代（它说的"是本机"其实只是"像本机"）
 */
export const isLocalAgentBase = isLoopbackAgentBase;

/**
 * [XG-CUSTOM] 反向命令通道客户端。
 *
 * 生命周期：`start()` 幂等启动后台循环；`stop()` 之后不再发任何请求。
 */
export class XiangwoBrowserRelay {
  private readonly resolveBaseUrl: () => Promise<string | null>;
  private readonly localCdpBase: string;
  /** 本机 9223 的 ws 基址（由 localCdpBase 推导，端口缺省 9223） */
  private readonly localWsBase: string;
  private readonly pollWaitSeconds: number;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: (url: string) => RelayWebSocket;
  private readonly log: (message: string, metadata?: Record<string, unknown>) => void;
  private readonly backoffStepsMs: readonly number[];
  private readonly skipLocalAgentBase: boolean;
  /** [XG-CUSTOM 2026-10-02] 无条件停用/无条件拨 + 身份探测注入点 */
  private readonly forceSkipLocalAgent: boolean;
  private readonly explicitTarget: boolean;
  private readonly probeHostname: (baseUrl: string) => Promise<string | null>;
  /** [XG-CUSTOM 2026-10-02] 本机主机名（判定"同机"用；缺省 os.hostname()） */
  private readonly localHostname: string;
  /** [XG-CUSTOM] 「从零开页」回调（null = 不支持，`open` 命令只报人话） */
  private readonly requestOpenBrowser: ((url: string) => void) | null;
  /** [XG-CUSTOM] 「从零开页」等待新 target 的上限 */
  private readonly openBrowserWaitMs: number;
  /** [XG-CUSTOM 2026-10-02] 多候选切换钩子（null = 旧行为，一个地址用到死） */
  private readonly onBaseUrlFailure: ((baseUrl: string) => boolean) | null;

  /** 稳定的 peer id（同一次运行内复用，便于对面日志认人） */
  readonly peerId = randomUUID();
  private readonly sessions = new Map<string, RelaySession>();
  private baseUrl = '';
  private running = false;
  private parked = false;
  private stopped = false;
  private backoffIndex = 0;
  private commandCount = 0;
  private errorCount = 0;
  private lastError = '';

  constructor(options: XiangwoBrowserRelayOptions) {
    this.resolveBaseUrl = options.resolveBaseUrl;
    this.localCdpBase = (options.localCdpBase ?? XIANGWO_RELAY_LOCAL_CDP_BASE).replace(/\/+$/, '');
    this.localWsBase = localWsBaseOf(this.localCdpBase);
    this.pollWaitSeconds = options.pollWaitSeconds ?? XIANGWO_RELAY_DEFAULT_WAIT_SECONDS;
    this.token = (options.token ?? process.env.XIANGWO_EMDASH_RELAY_TOKEN ?? '').trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as RelayWebSocket);
    this.log = options.log ?? (() => {});
    this.backoffStepsMs = options.backoffStepsMs ?? BACKOFF_STEPS_MS;
    this.skipLocalAgentBase = options.skipLocalAgentBase ?? true;
    this.forceSkipLocalAgent = options.forceSkipLocalAgent ?? false;
    this.explicitTarget = options.explicitTarget ?? false;
    this.probeHostname =
      options.probeHostname ??
      (async (baseUrl: string) => (await probeAgentIdentity(baseUrl, this.fetchImpl))?.hostname ?? null);
    this.localHostname = options.localHostname ?? osHostname();
    this.requestOpenBrowser = options.requestOpenBrowser ?? null;
    this.openBrowserWaitMs = options.openBrowserWaitMs ?? XIANGWO_RELAY_OPEN_BROWSER_WAIT_MS;
    this.onBaseUrlFailure = options.onBaseUrlFailure ?? null;
  }

  status(): XiangwoBrowserRelayStatus {
    return {
      enabled: this.running,
      baseUrl: this.baseUrl,
      peerId: this.peerId,
      parked: this.parked,
      commands: this.commandCount,
      errors: this.errorCount,
      sessions: this.sessions.size,
      lastError: this.lastError,
    };
  }

  /** 启动后台循环（幂等）。失败只打日志，绝不抛给启动链。 */
  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.loop();
  }

  /** 停止：不再发请求 + 关掉所有隧道里的 WS。 */
  stop(): void {
    this.stopped = true;
    this.running = false;
    for (const session of this.sessions.values()) {
      try {
        session.ws.close();
      } catch {
        // 关闭失败无所谓
      }
    }
    this.sessions.clear();
  }

  // ── 主循环 ───────────────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        if (this.baseUrl === '') {
          const resolved = await this.resolveBaseUrl();
          if (resolved === null || resolved.trim() === '') {
            this.noteError(
              '解析不出 Linux agent 地址（XIANGWO_BROWSER_RELAY_URL / SSH 主机都没拿到）'
            );
            await this.backoff();
            continue;
          }
          this.baseUrl = resolved.trim().replace(/\/+$/, '');
          if (this.skipLocalAgentBase && isLoopbackAgentBase(this.baseUrl)) {
            // [XG-CUSTOM 2026-10-02] 回环 + 8900 **不再**等于"agent 在本机"：
            // SSH 转发（`ssh -L 8900:127.0.0.1:8900`）长得一模一样。必须问对面一句
            // `/xg/whoami`，拿它报的 hostname 和本机比，才敢决定"这台不拨"。
            let decision: SkipLocalAgentDecision;
            try {
              decision = await decideSkipLocalAgent({
                baseUrl: this.baseUrl,
                localHostname: this.localHostname,
                forceSkip: this.forceSkipLocalAgent,
                explicitTarget: this.explicitTarget,
                probe: async () => {
                  const host = await this.probeHostname(this.baseUrl);
                  return host === null ? null : { hostname: host, instanceId: '', platform: '' };
                },
              });
            } catch (error) {
              decision = {
                skip: false,
                reason: 'unknown-agent',
                detail: `身份探测异常（${String(error)}）→ 按"远端"照拨`,
              };
            }
            this.log(`内嵌浏览器反向通道：避让判定 → ${decision.skip ? '不拨' : '拨'}`, {
              baseUrl: this.baseUrl,
              reason: decision.reason,
              detail: decision.detail,
            });
            if (decision.skip) {
              this.log(
                '内嵌浏览器反向通道：确证 agent 就在本机（127.0.0.1:8900）→ 本机 9223 桥已经够用，这台不拨' +
                  '（要强制开：设 XIANGWO_BROWSER_RELAY_URL 显式指定地址）'
              );
              this.stop();
              return;
            }
          }
          this.log(`内嵌浏览器反向通道已启用：出站连 ${this.baseUrl}（不开入站端口）`, {
            peerId: this.peerId,
            localCdpBase: this.localCdpBase,
          });
        }
        const command = await this.pollOnce();
        this.backoffIndex = 0;
        if (command === null) continue;
        await this.dispatch(command);
      } catch (error) {
        this.noteError(String(error));
        // [XG-CUSTOM 2026-10-02] 多候选自动切换：连续失败到阈值 → 清掉地址，
        // 下一轮 `resolveBaseUrl()` 会按候选优先级**重新选一条能用的路**。
        // 不接钩子（onBaseUrlFailure=null）时这段是空操作，行为与改动前完全一致。
        try {
          if (this.onBaseUrlFailure !== null && this.baseUrl !== '' && this.onBaseUrlFailure(this.baseUrl)) {
            this.log(`内嵌浏览器反向通道：换路重试（放弃 ${this.baseUrl}）`);
            this.baseUrl = '';
            this.backoffIndex = 0;
          }
        } catch {
          // 钩子自身出错绝不影响 relay
        }
        await this.backoff();
      }
    }
  }

  private async backoff(): Promise<void> {
    const step =
      this.backoffStepsMs[Math.min(this.backoffIndex, this.backoffStepsMs.length - 1)] ?? 15000;
    this.backoffIndex += 1;
    await sleep(step);
  }

  private noteError(message: string): void {
    this.errorCount += 1;
    if (this.lastError === message) return; // 同一个错别刷屏
    this.lastError = message;
    this.log(`内嵌浏览器反向通道：${message}`, { peerId: this.peerId, baseUrl: this.baseUrl });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token !== '') headers['X-Xiangwo-Relay-Token'] = this.token;
    return headers;
  }

  /** 一次长轮询：拿到命令 → 命令对象；204 → null（没命令）。 */
  private async pollOnce(): Promise<RelayCommand | null> {
    const url =
      `${this.baseUrl}/api/emdash-browser/poll?peer=${encodeURIComponent(this.peerId)}` +
      `&wait=${String(this.pollWaitSeconds)}&label=${encodeURIComponent('emdash-relay')}`;
    this.parked = true;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout((this.pollWaitSeconds + 15) * 1000),
      });
    } finally {
      this.parked = false;
    }
    if (response.status === 204) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`poll 返回 ${String(response.status)} ${text.slice(0, 160)}`);
    }
    const data = (await response.json()) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    const command = data as RelayCommand;
    if (typeof command.id !== 'number' || typeof command.kind !== 'string') return null;
    return command;
  }

  private async postJson(path: string, body: unknown): Promise<void> {
    await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  }

  private async result(id: number, ok: boolean, payload?: unknown, error?: string): Promise<void> {
    try {
      await this.postJson('/api/emdash-browser/result', {
        peer: this.peerId,
        id,
        ok,
        payload: payload ?? null,
        error: error ?? '',
      });
    } catch (e) {
      this.noteError(`回传结果失败：${String(e)}`);
    }
  }

  private async dispatch(command: RelayCommand): Promise<void> {
    this.commandCount += 1;
    const kind = command.kind;
    try {
      if (kind === 'ping') {
        await this.result(command.id, true, { pong: Date.now() });
        return;
      }
      if (kind === 'http') {
        await this.handleHttp(command);
        return;
      }
      if (kind === 'ws-open') {
        await this.handleWsOpen(command);
        return;
      }
      if (kind === 'ws-send') {
        await this.handleWsSend(command);
        return;
      }
      if (kind === 'ws-close') {
        await this.handleWsClose(command);
        return;
      }
      if (kind === 'open') {
        await this.handleOpen(command);
        return;
      }
      await this.result(command.id, false, null, `未知命令 ${kind}`);
    } catch (error) {
      await this.result(command.id, false, null, String(error));
    }
  }

  // ── http：把对面要的 9223 路径打过来，原样把响应体带回去 ────────────────

  private async handleHttp(command: RelayCommand): Promise<void> {
    const method = typeof command.method === 'string' ? command.method : 'GET';
    const path = typeof command.path === 'string' ? command.path : '/';
    if (!path.startsWith('/')) {
      await this.result(command.id, false, null, `非法路径 ${path}`);
      return;
    }
    const response = await this.fetchImpl(`${this.localCdpBase}${path}`, {
      method,
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.text();
    await this.result(command.id, true, {
      status: response.status,
      body,
      content_type: response.headers.get('content-type') ?? 'application/json',
    });
  }

  // ── ws：把对面的 CDP WebSocket 会话桥到本机 9223 的同名路径 ─────────────

  private async handleWsOpen(command: RelayCommand): Promise<void> {
    const sid = String(command.sid ?? '');
    const path = String(command.path ?? '');
    if (sid === '' || !path.startsWith('/')) {
      await this.result(command.id, false, null, 'ws-open 缺少 sid/path');
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let ws: RelayWebSocket;
      try {
        ws = this.webSocketFactory(`${this.localWsBase}${path}`);
      } catch (error) {
        void this.result(command.id, false, null, `连本机 9223 失败：${String(error)}`).then(() =>
          resolve()
        );
        return;
      }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          // 忽略
        }
        void this.result(command.id, false, null, `打开本机 9223 WS 超时（${path}）`).then(() =>
          resolve()
        );
      }, WS_OPEN_TIMEOUT_MS);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sessions.set(sid, { sid, ws, buffer: [], flushing: false, closed: false });
        ws.onmessage = (event) => {
          const data = typeof event.data === 'string' ? event.data : String(event.data);
          this.bufferFrame(sid, data);
        };
        ws.onclose = () => {
          this.sessions.delete(sid);
          void this.postJson('/api/emdash-browser/event', {
            peer: this.peerId,
            kind: 'ws-closed',
            sid,
          }).catch(() => undefined);
        };
        ws.onerror = () => undefined;
        void this.result(command.id, true, { sid }).then(() => resolve());
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void this.result(command.id, false, null, '连本机 9223 WS 出错').then(() => resolve());
      };
    });
  }

  private async handleWsSend(command: RelayCommand): Promise<void> {
    const sid = String(command.sid ?? '');
    const session = this.sessions.get(sid);
    if (session === undefined) {
      await this.result(command.id, false, null, `会话 ${sid} 不存在（对面 9223 可能已断开）`);
      return;
    }
    const data = typeof command.data === 'string' ? command.data : '';
    try {
      session.ws.send(data);
      await this.result(command.id, true, { sent: data.length });
    } catch (error) {
      await this.result(command.id, false, null, `发送失败：${String(error)}`);
    }
  }

  private async handleWsClose(command: RelayCommand): Promise<void> {
    const sid = String(command.sid ?? '');
    const session = this.sessions.get(sid);
    this.sessions.delete(sid);
    if (session !== undefined && !session.closed) {
      session.closed = true;
      try {
        session.ws.close();
      } catch {
        // 忽略
      }
    }
    await this.result(command.id, true, { closed: sid });
  }

  /** CDP 帧回传：串行化 + 微合批，保证顺序又少开 POST */
  private bufferFrame(sid: string, frame: string): void {
    const session = this.sessions.get(sid);
    if (session === undefined || session.closed) return;
    session.buffer.push(frame);
    if (session.flushing) return;
    session.flushing = true;
    void (async () => {
      while (session.buffer.length > 0) {
        const frames = session.buffer.splice(0, session.buffer.length);
        try {
          await this.postJson('/api/emdash-browser/event', {
            peer: this.peerId,
            kind: 'ws-msg',
            sid,
            frames,
          });
        } catch {
          // 对面暂时不通：丢掉这几帧（CDP 客户端自己会超时报错），不阻塞其它会话
        }
      }
      session.flushing = false;
    })();
  }

  // ── open：让"说打开什么网页就打开什么"在跨机场景也成立 ───────────────────
  //
  // 先列本机 9223 上白名单里的内嵌浏览器：有就 Page.navigate 过去（用户肉眼可见）；
  // 一个都没有 → [XG-CUSTOM] 先请渲染进程开一个（`requestOpenBrowser`，与 9223 桥
  // `/xg/open-browser` 同一套机制），等它被绑定再导航。
  // 还是开不出来 → 回一句能照做的人话（**不偷偷去操作别的浏览器**，这是 agent.py 里
  // 反复强调的"错浏览器"坑）。

  private async handleOpen(command: RelayCommand): Promise<void> {
    const url = String(command.url ?? '').trim();
    if (url === '') {
      await this.result(command.id, false, null, 'open 缺少 url');
      return;
    }
    const fragment = String(command.fragment ?? '').trim();
    let targets = await this.listLocalTargets();
    let autoOpenAttempted = false;
    if (targets.length === 0 && this.requestOpenBrowser !== null) {
      autoOpenAttempted = true;
      try {
        this.requestOpenBrowser(url);
        this.log('内嵌浏览器从零开页（反向通道）：已请求渲染进程开 Browser 标签页', { url });
      } catch (error) {
        this.noteError(`广播开页请求失败：${String(error)}`);
      }
      targets = await this.waitForLocalTarget(new Set<string>(), this.openBrowserWaitMs);
    }
    if (targets.length === 0) {
      await this.result(
        command.id,
        false,
        null,
        'emdash 里当前没有打开的内嵌浏览器标签页' +
          (autoOpenAttempted
            ? '（已经请 emdash 自动开一个但没等到：渲染进程可能没停在 task 视图）'
            : '（先在 emdash 主窗口开一个浏览器标签，再让 agent 操作）') +
          '；这不是配置，是页面'
      );
      return;
    }
    const target =
      (fragment === '' ? undefined : targets.find((t) => t.url.includes(fragment))) ?? targets[0];
    if (target === undefined || target.webSocketDebuggerUrl === '') {
      await this.result(command.id, false, null, '内嵌浏览器 target 没有 CDP 地址');
      return;
    }
    const before = target.url;
    await cdpCallOnce(this.webSocketFactory, target.webSocketDebuggerUrl, 'Page.navigate', { url });
    await this.result(command.id, true, {
      url,
      requested: url,
      target_id: target.id,
      before_url: before,
      title: target.title,
    });
  }

  /** [XG-CUSTOM] 轮询等本机 9223 上出现一个已绑定的内嵌浏览器（150ms 一拍，超时回 []） */
  private async waitForLocalTarget(
    known: ReadonlySet<string>,
    waitMs: number
  ): Promise<Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string }>> {
    const deadline = Date.now() + Math.max(0, waitMs);
    for (;;) {
      const targets = await this.listLocalTargets().catch(() => []);
      const fresh = targets.filter((target) => !known.has(target.id));
      if (fresh.length > 0) return fresh;
      if (Date.now() >= deadline) return [];
      await sleep(XIANGWO_RELAY_OPEN_BROWSER_POLL_MS);
    }
  }

  private async listLocalTargets(): Promise<
    Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string }>
  > {
    const response = await this.fetchImpl(`${this.localCdpBase}/json/list`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`本机 9223 /json/list 返回 ${String(response.status)}`);
    const raw = (await response.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: String(item.id ?? ''),
        url: String(item.url ?? ''),
        title: String(item.title ?? ''),
        webSocketDebuggerUrl: String(item.webSocketDebuggerUrl ?? ''),
      }))
      .filter((item) => item.id !== '');
  }
}

/** 一次性 CDP 调用（开 WS → 发一条 → 收结果 → 关）。超时只抛错，绝不 hang。 */
export function cdpCallOnce(
  factory: (url: string) => RelayWebSocket,
  wsUrl: string,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let ws: RelayWebSocket;
    try {
      ws = factory(wsUrl);
    } catch (error) {
      reject(new Error(`连 CDP 失败：${String(error)}`));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // 忽略
      }
      reject(new Error('CDP 超时'));
    }, CDP_ONCE_TIMEOUT_MS);
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ id: 1, method, params: params ?? {} }));
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`CDP 发送失败：${String(error)}`));
      }
    };
    ws.onmessage = (event) => {
      if (settled) return;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // 忽略
      }
      if (message.error !== undefined) reject(new Error(message.error.message ?? 'CDP error'));
      else resolve(message.result);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('CDP WS 出错'));
    };
  });
}

/** [XG-CUSTOM] 从环境变量造一个 relay（wiring 用；单测直接 new）。 */
export function createXiangwoBrowserRelay(
  resolveBaseUrl: () => Promise<string | null>,
  log: (message: string, metadata?: Record<string, unknown>) => void,
  requestOpenBrowser?: (url: string) => void,
  /**
   * [XG-CUSTOM 2026-10-02] 可选覆盖（多候选自动切换用）：把
   * `RelayCandidateSelector.noteFailure` 接进来即可 —— 地址本身由第 1 个参数
   * （`RelayCandidateSelector.resolve`）给。不传 = 与改动前逐字一致的行为。
   */
  overrides?: { onBaseUrlFailure?: (baseUrl: string) => boolean }
): XiangwoBrowserRelay | null {
  if (!relayEnabledFromEnv(process.env.XIANGWO_BROWSER_RELAY)) return null;
  const explicit = (process.env.XIANGWO_BROWSER_RELAY_URL ?? '').trim();
  return new XiangwoBrowserRelay({
    resolveBaseUrl: async () => (explicit !== '' ? explicit : await resolveBaseUrl()),
    localCdpBase:
      (process.env.XIANGWO_EMDASH_CDP_BASE ?? '').trim() || XIANGWO_RELAY_LOCAL_CDP_BASE,
    pollWaitSeconds: parseWaitSeconds(process.env.XIANGWO_BROWSER_RELAY_WAIT),
    // 只有"自动解析"时才允许因"本机就是 agent"而自我停用；显式给了地址就照跑（自测/强制场景）
    skipLocalAgentBase: explicit === '',
    // [XG-CUSTOM 2026-10-02] 显式地址 = 无条件拨；SKIP_LOCAL_AGENT=1 = 无条件停用（只有家里 Linux 该设）
    explicitTarget: explicit !== '',
    forceSkipLocalAgent: relaySkipLocalAgentFromEnv(
      process.env.XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT
    ),
    // [XG-CUSTOM] 「从零开页」：本机一个内嵌浏览器都没有时，请渲染进程开一个
    ...(requestOpenBrowser !== undefined ? { requestOpenBrowser } : {}),
    // [XG-CUSTOM 2026-10-02] 多候选切换：连续失败到阈值就换下一条候选
    ...(overrides?.onBaseUrlFailure !== undefined
      ? { onBaseUrlFailure: overrides.onBaseUrlFailure }
      : {}),
    log,
  });
}
