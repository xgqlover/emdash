// [XG-CUSTOM 2026-10-02] 反向通道「**多候选地址 + 自动切换**」。
//
// ## 为什么需要它（真机现象）
//
// 原来的解析是**单来源**的：`XIANGWO_BROWSER_RELAY_URL` > SSH 转发 > 主机地址
// （见 `xiangwo-chat-target.ts:resolveXiangwoChatTarget`）。于是：
//   · 解析出哪条路，就**只**走哪条 —— 那条路一断（网线拔了 / ZeroTier 掉线 /
//     tailscale 被墙 / 家里光猫没配端口映射），整条反向通道全断，没有任何备用；
//   · relay 的 `baseUrl` 一旦定下**永不重解析**（`xiangwo-browser-relay.ts` 主循环里
//     `if (this.baseUrl === '')`），所以死路会一直退避重试，直到进程重启。
//
// 本模块把"地址"从一个**字符串**变成一个**有序候选池 + 健康探测 + 记住上次成功**。
//
// ## 候选顺序（照用户定的价值序）
//
//   1. `XIANGWO_BROWSER_RELAY_URL`（显式手写，最高优先；仍然"设了就拨"，但**不再是唯一**）
//   2. **上次成功的那个**（落盘记住，跨重启；这是"秒回"的关键）
//   3. 直连网线   `http://192.168.2.10:8900`   （Win 192.168.2.20 ↔ Linux 192.168.2.10）
//   4. ZeroTier   `http://10.239.5.174:8900`
//   5. tailscale  `http://100.125.4.119:8900`
//   6. 本机/SSH 转发 `http://127.0.0.1:8900`
//   7. 兜底：`resolveXiangwoChatTarget()` 动态解析出来的（SSH 转发/远程主机地址，去重后追加）
//
// ## 探测与切换
//
// - 探测 = `GET {base}/xg/whoami`，**默认 1500ms 超时**（`AbortSignal.timeout`）。
//   轻、无副作用、对面本来就有这个端点（`emdash_browser_hub.py:WHOAMI_PATH`）。
//   **收到任何 HTTP 响应就算"这条路活着"**（401/403 也说明 8900 在监听 —— 比"没路"强）。
// - 失败 → 立刻试下一个（不等待、不退避），所以"一条路断了"的切换耗时 ≈ 该路的超时。
// - 成功 → 缓存 + 落盘 + 日志写清"当前用哪条路"；`recheckMs`（默认 **5 分钟**）内直接复用，
//   不再探测（避免每条命令都打一轮）；超过 5 分钟**复检当前这条路**，死了就切。
// - relay 报传输错误时调 `noteFailure()`：连续失败到阈值（默认 3）→ 把当前路**冷却**
//   （默认 60s）并让 relay 重解析 —— 这样"TCP 还连着但实际黑洞"的情况也能切走。
//
// ## 不抢 relay 已有的"避让判定"
//
// `decideSkipLocalAgent()`（26c44e61 的改动）负责"这台机器自己就是 agent → 不拨"。
// 本模块**不重复**这件事，只做一件它做不到的事：**探测时就认出"对面是我自己"**，
// 于是把自机候选排到最后。判据同样是 `/xg/whoami` 的 hostname == 本机 hostname。
//    · 家里 Linux：4 个候选全是自机 → 全都标 self → 返回"最像本机"的那个（回环优先），
//      交给 relay 的 `decideSkipLocalAgent` 干净地自我停用（**行为与改动前一致**，
//      绝不出现"Linux 自己经 192.168.2.10 拨自己"这种把跨机通道抢掉的事故）；
//    · 外地 Windows：hostname 是 Linux 那台 → 不是 self → 正常拨。
//   hostname 拿不到（旧 hub）→ 按"不是 self"处理（与既有取舍一致：宁可多拨）。
//
// 本模块**不 import electron**（纯 Node 逻辑 + 注入 `fetch`），单测零依赖。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { dirname, join } from 'node:path';

/** 缺省静态候选（按优先级）。用户可用 `XIANGWO_RELAY_CANDIDATES` 覆盖/追加。 */
export const XIANGWO_RELAY_DEFAULT_CANDIDATE_URLS = [
  'http://192.168.2.10:8900', // 直连网线
  'http://10.239.5.174:8900', // ZeroTier
  'http://100.125.4.119:8900', // tailscale
  'http://127.0.0.1:8900', // 本机 / SSH 转发（`ssh -L 8900:127.0.0.1:8900`）
] as const;

/** 候选来源（日志/排查用；与 `xiangwo-chat-target.ts:XiangwoChatSource` 同一套口径） */
export type RelayCandidateSource = 'explicit' | 'last-good' | 'lan' | 'zerotier' | 'tailscale' | 'local' | 'custom' | 'dynamic';

export type RelayCandidate = {
  /** 基址，无尾斜杠，形如 `http://host:8900` */
  url: string;
  source: RelayCandidateSource;
  /** 给人看的短标签（日志里"当前用哪条路"就是它） */
  label: string;
};

export const XIANGWO_RELAY_PROBE_PATH = '/xg/whoami';
export const XIANGWO_RELAY_PROBE_DEFAULT_TIMEOUT_MS = 1500;
export const XIANGWO_RELAY_RECHECK_DEFAULT_MS = 300_000; // 5 分钟
export const XIANGWO_RELAY_FAILURES_BEFORE_SWITCH = 3;
export const XIANGWO_RELAY_COOLDOWN_DEFAULT_MS = 60_000;

/** 去尾斜杠 + 去空白（`http://a:1///` → `http://a:1`） */
export function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

/** 主机名规范化（大小写 / FQDN 尾点 / 首尾空白都不算差异；与 relay 内同名函数同口径） */
export function normalizeHostnameLoose(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

/** 猜一个候选的"是什么路"（用于给用户可读标签） */
export function classifyCandidateUrl(url: string): RelayCandidate {
  const base = normalizeBaseUrl(url);
  if (base === 'http://192.168.2.10:8900') return { url: base, source: 'lan', label: '直连网线' };
  if (base === 'http://10.239.5.174:8900') return { url: base, source: 'zerotier', label: 'ZeroTier' };
  if (base === 'http://100.125.4.119:8900') return { url: base, source: 'tailscale', label: 'tailscale' };
  if (base === 'http://127.0.0.1:8900') return { url: base, source: 'local', label: '本机/SSH转发' };
  return { url: base, source: 'custom', label: base === '' ? '(空)' : base };
}

/**
 * 解析 `XIANGWO_RELAY_CANDIDATES`：
 *   · `a,b,c`   → **替换**内置静态候选
 *   · `+a,b,c`  → 在内置静态候选**前面插入**
 * 空串 / 未设 → null（用内置）。单项非法（不含 `://`）直接忽略。
 */
export function parseRelayCandidateEnv(raw: string | undefined): { prepend: RelayCandidate[]; replace: RelayCandidate[] } | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  const extend = value.startsWith('+');
  const body = extend ? value.slice(1) : value;
  const list: RelayCandidate[] = [];
  for (const piece of body.split(',')) {
    const url = normalizeBaseUrl(piece);
    if (url === '' || !/^https?:\/\//i.test(url)) continue;
    list.push({ ...classifyCandidateUrl(url), source: 'custom', label: `自定义 ${url}` });
  }
  if (list.length === 0) return null;
  return extend ? { prepend: list, replace: [] } : { prepend: [], replace: list };
}

/** 去重（保留第一次出现）+ 丢掉空项 */
export function dedupeCandidates(list: RelayCandidate[]): RelayCandidate[] {
  const seen = new Set<string>();
  const out: RelayCandidate[] = [];
  for (const item of list) {
    const url = normalizeBaseUrl(item.url);
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...item, url });
  }
  return out;
}

/**
 * 造出**本次解析用**的有序候选池。
 *
 * `lastGood` 放在 explicit 之后、静态候选之前 —— 这是"记住上次成功的那个"的落点：
 * 网络没变时第一个探测的就是它对不对，通常一次探测（毫秒级）就定下来。
 */
export function buildRelayCandidates(input: {
  explicit?: string;
  lastGood?: string | null;
  envRaw?: string | undefined;
  extra?: RelayCandidate[];
}): RelayCandidate[] {
  const head: RelayCandidate[] = [];
  const explicit = normalizeBaseUrl(input.explicit ?? '');
  if (explicit !== '') {
    head.push({ ...classifyCandidateUrl(explicit), source: 'explicit', label: `显式指定 ${explicit}` });
  }
  const lastGood = normalizeBaseUrl(input.lastGood ?? '');
  if (lastGood !== '') {
    const classified = classifyCandidateUrl(lastGood);
    head.push({ ...classified, source: 'last-good', label: `${classified.label}（上次成功）` });
  }
  const parsed = parseRelayCandidateEnv(input.envRaw);
  const staticDefaults: RelayCandidate[] = XIANGWO_RELAY_DEFAULT_CANDIDATE_URLS.map((url) =>
    classifyCandidateUrl(url)
  );
  const middle: RelayCandidate[] = parsed === null
    ? staticDefaults
    : parsed.replace.length > 0
      ? parsed.replace
      : staticDefaults;
  const prepended: RelayCandidate[] = parsed?.prepend ?? [];
  const tail: RelayCandidate[] = (input.extra ?? []).map((item) => ({ ...item }));
  return dedupeCandidates([...head, ...prepended, ...middle, ...tail]);
}

// ── 健康探测 ────────────────────────────────────────────────────────────────

export type RelayCandidateHealth = {
  url: string;
  /** 这条路现在能不能用（收到任何 HTTP 响应 = true，即使 4xx/5xx） */
  ok: boolean;
  /** 收到的 HTTP 状态码（没收到 → -1） */
  status: number;
  /** 对面报的 hostname（拿不到 → ''） */
  hostname: string;
  /** 对面就是本机自己（hostname 与本机相同）→ 不该拨 */
  isSelf: boolean;
  /** 探测耗时 ms */
  ms: number;
  /** 失败原因（人话，成功时空串） */
  error: string;
};

/**
 * 探测一条候选：`GET {base}/xg/whoami`，超时即失败。
 *
 * **永不抛异常**：网络错 / 超时 / JSON 坏 / 对面是别的东西，都只是 ok=false 或 hostname=''。
 * "收到响应就算活着"是同一条通道能不能承载长轮询的**必要**条件，够用且足够轻：
 * 401/403（token 或来源白名单拒了）意味着 8900 在监听、下一跳是对的，比"没路"强得多。
 */
export async function probeRelayCandidate(
  candidate: RelayCandidate,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    localHostname?: string;
    now?: () => number;
  } = {}
): Promise<RelayCandidateHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? XIANGWO_RELAY_PROBE_DEFAULT_TIMEOUT_MS;
  const localHost = normalizeHostnameLoose(options.localHostname ?? osHostname());
  const now = options.now ?? (() => Date.now());
  const started = now();
  const base = normalizeBaseUrl(candidate.url);
  const result: RelayCandidateHealth = {
    url: base,
    ok: false,
    status: -1,
    hostname: '',
    isSelf: false,
    ms: 0,
    error: '',
  };
  if (base === '') {
    result.error = '空地址';
    return result;
  }
  try {
    const response = await fetchImpl(`${base}${XIANGWO_RELAY_PROBE_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    result.ok = true; // 收到响应就算这条路活着
    result.status = response.status;
    try {
      const data = (await response.json()) as unknown;
      if (typeof data === 'object' && data !== null) {
        const record = data as Record<string, unknown>;
        if (typeof record.hostname === 'string') result.hostname = record.hostname;
      }
    } catch {
      // 不是 JSON（对面是别的服务/旧版）→ hostname 留空 = "不知道"，按"不是 self"处理
    }
    const remoteHost = normalizeHostnameLoose(result.hostname);
    result.isSelf = remoteHost !== '' && localHost !== '' && remoteHost === localHost;
  } catch (error) {
    const kind = error instanceof Error ? error.name : 'Error';
    const isTimeout = kind === 'TimeoutError' || kind === 'AbortError';
    result.error = `${isTimeout ? `超时 >${String(timeoutMs)}ms` : kind}：${error instanceof Error ? error.message : String(error)}`;
  }
  result.ms = Math.max(0, now() - started);
  return result;
}

// ── 选择器 ──────────────────────────────────────────────────────────────────

export type RelaySelectorState = {
  current: string;
  currentLabel: string;
  /** 当前这条路是什么时候确认的（epoch ms；0 = 还没定） */
  confirmedAt: number;
  /** 切换次数 */
  switches: number;
  /** 每轮探测的原始结果（排查用，最多留 12 条） */
  lastProbes: RelayCandidateHealth[];
  /** 处于冷却（刚被判定坏掉）的地址 → 冷却到期的 epoch ms */
  cooling: Record<string, number>;
  /** 落盘文件（null = 不落盘） */
  stateFile: string | null;
};

export type RelayCandidateSelectorOptions = {
  /** 显式 `XIANGWO_BROWSER_RELAY_URL`（最高优先，仍然"设了就拨"） */
  explicit?: string;
  /** 追加在静态候选之后的动态候选（例如 `resolveXiangwoChatTarget()` 的结果） */
  extraCandidates?: () => Promise<RelayCandidate[]>;
  /** 探针（单测注入；缺省真去 GET /xg/whoami） */
  probe?: (candidate: RelayCandidate) => Promise<RelayCandidateHealth>;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
  localHostname?: string;
  /** 成功后多久内不再探测（缺省 5 分钟） */
  recheckMs?: number;
  /** 连续失败几次就判定"这条坏了"（缺省 3） */
  failuresBeforeSwitch?: number;
  /** 坏掉后的冷却时长（缺省 60s） */
  cooldownMs?: number;
  /** 上次成功的持久化文件（null/'' = 不落盘） */
  stateFile?: string | null;
  /** `XIANGWO_RELAY_CANDIDATES` 原始值（单测注入） */
  candidatesEnv?: string | undefined;
  now?: () => number;
};

const DEFAULT_STATE_FILE = join(
  process.env.XIANGWO_RELAY_STATE_DIR ?? join(process.env.HOME ?? '.', '.xiangwo'),
  'relay-lastgood.json'
);

type PersistedState = { url?: unknown; at?: unknown };

/**
 * 多候选选择器：**先选中一条活的路，再记住它，坏了就换**。
 *
 * 线程/调用安全：`resolve()` 内部用 in-flight promise 去重（主进程里可能被多处并发调）。
 * 对外**永不抛**：探测异常一律当作"这条路不可用"。
 */
export class RelayCandidateSelector {
  private readonly options: RelayCandidateSelectorOptions;
  private readonly recheckMs: number;
  private readonly failuresBeforeSwitch: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private current = '';
  private currentLabel = '';
  private confirmedAt = 0;
  private switches = 0;
  private lastProbes: RelayCandidateHealth[] = [];
  private lastGood = '';
  private cooling = new Map<string, number>();
  private failures = new Map<string, number>();
  private inFlight: Promise<string | null> | undefined;
  private extraCache: RelayCandidate[] | undefined;
  private readonly log: (message: string, metadata?: Record<string, unknown>) => void;

  constructor(options: RelayCandidateSelectorOptions = {}) {
    this.options = options;
    this.recheckMs = options.recheckMs ?? XIANGWO_RELAY_RECHECK_DEFAULT_MS;
    this.failuresBeforeSwitch = options.failuresBeforeSwitch ?? XIANGWO_RELAY_FAILURES_BEFORE_SWITCH;
    this.cooldownMs = options.cooldownMs ?? XIANGWO_RELAY_COOLDOWN_DEFAULT_MS;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
    this.lastGood = this.loadLastGood();
    if (this.lastGood !== '') {
      this.log(`反向通道：上次成功的路是 ${this.lastGood}（优先重试）`, { lastGood: this.lastGood });
    }
  }

  /** 当前正在用的地址（'' = 还没定） */
  get activeUrl(): string {
    return this.current;
  }

  state(): RelaySelectorState {
    return {
      current: this.current,
      currentLabel: this.currentLabel,
      confirmedAt: this.confirmedAt,
      switches: this.switches,
      lastProbes: [...this.lastProbes],
      cooling: Object.fromEntries(this.cooling),
      stateFile: this.stateFile(),
    };
  }

  /**
   * 解析出**现在能用的**基址。`null` = 一个候选都不通（调用方该退避重试）。
   *
   * 冷启动：按优先级逐条探测，第一条通的就是它（**一条路断了就自动走到下一条**）。
   * 已定过：`recheckMs` 内直接返回（零探测）；到期则**复检当前这条路**，还通就续期，
   * 不通就往下换。
   */
  resolve(): Promise<string | null> {
    if (this.inFlight !== undefined) return this.inFlight;
    this.inFlight = this.doResolve()
      .catch((error: unknown) => {
        this.log(`反向通道：候选解析异常（按"都不通"处理）：${String(error)}`);
        return null;
      })
      .then((value) => {
        this.inFlight = undefined;
        return value;
      });
    return this.inFlight;
  }

  /**
   * relay 报"这条路的请求失败了"。连续失败到阈值 → 冷却它 + 清掉当前选择，
   * 让下一次 `resolve()` 重新选路。返回 true = 已判定该换路（relay 应重解析）。
   */
  noteFailure(url: string): boolean {
    const base = normalizeBaseUrl(url);
    if (base === '') return false;
    const count = (this.failures.get(base) ?? 0) + 1;
    this.failures.set(base, count);
    this.log(`反向通道：${base} 第 ${String(count)} 次失败（${String(this.failuresBeforeSwitch)} 次换路）`, {
      url: base,
      count,
    });
    if (count < this.failuresBeforeSwitch) return false;
    this.failures.set(base, 0);
    this.cooling.set(base, this.now() + this.cooldownMs);
    if (this.current === base) {
      this.current = '';
      this.currentLabel = '';
      this.confirmedAt = 0;
    }
    this.log(`反向通道：判定 ${base} 这条路不通 → 冷却 ${String(Math.round(this.cooldownMs / 1000))}s，换下一条`, {
      url: base,
    });
    return true;
  }

  /** 清掉内存里的当前选择（不动落盘的 last-good；单测/排查用） */
  reset(): void {
    this.current = '';
    this.currentLabel = '';
    this.confirmedAt = 0;
    this.failures.clear();
    this.cooling.clear();
    this.extraCache = undefined;
    this.inFlight = undefined;
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private stateFile(): string | null {
    const raw = this.options.stateFile;
    if (raw === null) return null;
    const value = (raw ?? DEFAULT_STATE_FILE).trim();
    return value === '' ? null : value;
  }

  private loadLastGood(): string {
    const file = this.stateFile();
    if (file === null || !existsSync(file)) return '';
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as PersistedState;
      return normalizeBaseUrl(typeof parsed.url === 'string' ? parsed.url : '');
    } catch {
      return ''; // 坏文件 = 没有记忆，绝不因为一个缓存文件把功能带崩
    }
  }

  /** 落盘（同步、失败即吞）：这个文件只是"加速"，丢了最多多探一轮 */
  private saveLastGood(url: string): void {
    const file = this.stateFile();
    if (file === null) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ url, at: this.now() }), 'utf8');
    } catch (error) {
      this.log(`反向通道：上次成功的路写盘失败（不影响功能）：${String(error)}`);
    }
  }

  private async collectDynamic(): Promise<RelayCandidate[]> {
    if (this.extraCache !== undefined) return this.extraCache;
    const factory = this.options.extraCandidates;
    if (factory === undefined) {
      this.extraCache = [];
      return this.extraCache;
    }
    try {
      const list = await factory();
      this.extraCache = Array.isArray(list) ? list : [];
    } catch (error) {
      this.log(`反向通道：动态候选解析失败（跳过）：${String(error)}`);
      this.extraCache = [];
    }
    return this.extraCache;
  }

  private async probeOne(candidate: RelayCandidate): Promise<RelayCandidateHealth> {
    const probe = this.options.probe;
    if (probe === undefined) {
      return probeRelayCandidate(candidate, {
        timeoutMs: XIANGWO_RELAY_PROBE_DEFAULT_TIMEOUT_MS,
        ...(this.options.localHostname === undefined ? {} : { localHostname: this.options.localHostname }),
      });
    }
    try {
      return await probe(candidate);
    } catch (error) {
      return {
        url: candidate.url,
        ok: false,
        status: -1,
        hostname: '',
        isSelf: false,
        ms: 0,
        error: `探针异常：${String(error)}`,
      };
    }
  }

  private async doResolve(): Promise<string | null> {
    const now = this.now();
    if (this.current !== '' && now - this.confirmedAt < this.recheckMs) {
      return this.current;
    }
    const dynamic = await this.collectDynamic();
    const candidates = buildRelayCandidates({
      explicit: this.options.explicit ?? '',
      lastGood: this.lastGood,
      envRaw: this.options.candidatesEnv,
      extra: dynamic,
    });
    if (candidates.length === 0) {
      this.log('反向通道：候选池为空（检查 XIANGWO_RELAY_CANDIDATES）');
      return null;
    }

    const probes: RelayCandidateHealth[] = [];
    let selfHit: { candidate: RelayCandidate; health: RelayCandidateHealth } | null = null;
    // 回环优先当作"最像本机自己"的落点：它能让 relay 的避让判定走最短路径
    let selfBestRank = -1;

    for (const candidate of candidates) {
      const until = this.cooling.get(candidate.url) ?? 0;
      if (until > now && candidates.some((c) => (this.cooling.get(c.url) ?? 0) <= now)) {
        // 还在冷却里，且池子里还有别的可试 → 跳过它（**这就是"失败快速切换"不回头的原因**）
        this.log(`反向通道：跳过 ${candidate.label} ${candidate.url}（冷却中）`, { url: candidate.url });
        continue;
      }
      const health = await this.probeOne(candidate);
      probes.push(health);
      if (!health.ok) {
        this.log(
          `反向通道：${candidate.label} ${candidate.url} 不通（${String(health.ms)}ms）→ 试下一个：${health.error}`,
          { url: candidate.url }
        );
        continue;
      }
      if (health.isSelf) {
        // 对面就是本机（家里 Linux 的四个候选都这样）→ 不当成可用路，只留作"自我停用"的落点
        const rank = candidate.url.includes('127.0.0.1') ? 2 : 1;
        this.log(`反向通道：${candidate.label} ${candidate.url} 是本机自己（hostname=${health.hostname}）→ 不拨`, {
          url: candidate.url,
        });
        if (selfHit === null || rank > selfBestRank) {
          selfHit = { candidate, health };
          selfBestRank = rank;
        }
        continue;
      }
      this.rememberProbes(probes);
      this.adopt(candidate, health, now);
      return candidate.url;
    }

    this.rememberProbes(probes);

    if (selfHit !== null) {
      // 只有"本机自己"这一种可能 → 把地址交回去，让 relay 的 decideSkipLocalAgent 走
      // "同机 → 自我停用"的既定路径（**改动前就是这样，不能变成"Linux 经网线拨自己"**）。
      this.log(
        `反向通道：所有候选都指向本机自己 → 交回 ${selfHit.candidate.url} 让避让判定处理（预期：不拨）`,
        { url: selfHit.candidate.url, hostname: selfHit.health.hostname }
      );
      this.current = selfHit.candidate.url;
      this.currentLabel = selfHit.candidate.label;
      this.confirmedAt = now;
      return selfHit.candidate.url;
    }

    this.log(`反向通道：${String(candidates.length)} 条候选**全部不通**（网络断了？）→ 退避后重试`, {
      tried: probes.map((p) => `${p.url}(${p.error || String(p.status)})`),
    });
    return null;
  }

  private rememberProbes(probes: RelayCandidateHealth[]): void {
    this.lastProbes = [...probes, ...this.lastProbes].slice(0, 12);
  }

  private adopt(candidate: RelayCandidate, health: RelayCandidateHealth, now: number): void {
    const previous = this.current;
    this.current = candidate.url;
    this.currentLabel = candidate.label;
    this.confirmedAt = now;
    this.failures.set(candidate.url, 0);
    this.cooling.delete(candidate.url);
    this.lastGood = candidate.url;
    this.saveLastGood(candidate.url);
    if (previous !== '' && previous !== candidate.url) {
      this.switches += 1;
      this.log(
        `反向通道：**切换** ${previous} → ${candidate.url}（${candidate.label}，探到 ${String(health.ms)}ms）——当前用这条路`,
        { from: previous, to: candidate.url }
      );
    } else {
      this.log(
        `反向通道：**当前用 ${candidate.label}** ${candidate.url}（${String(health.ms)}ms，hostname=${health.hostname || '未知'}，${String(Math.round(this.recheckMs / 1000))}s 后复检）`,
        { url: candidate.url, source: candidate.source, status: health.status }
      );
    }
  }
}

/** 从环境变量造一个选择器（wiring 用；单测直接 `new RelayCandidateSelector`）。 */
export function createRelayCandidateSelector(options: {
  explicit?: string;
  extraCandidates?: () => Promise<RelayCandidate[]>;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
  probe?: (candidate: RelayCandidate) => Promise<RelayCandidateHealth>;
}): RelayCandidateSelector {
  const env = process.env;
  const parseMs = (raw: string | undefined, fallback: number): number => {
    const value = Number.parseInt((raw ?? '').trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const parseCount = (raw: string | undefined, fallback: number): number => {
    const value = Number.parseInt((raw ?? '').trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return new RelayCandidateSelector({
    ...options,
    explicit: options.explicit ?? (env.XIANGWO_BROWSER_RELAY_URL ?? '').trim(),
    recheckMs: parseMs(env.XIANGWO_RELAY_RECHECK_MS, XIANGWO_RELAY_RECHECK_DEFAULT_MS),
    failuresBeforeSwitch: parseCount(env.XIANGWO_RELAY_FAILURES_BEFORE_SWITCH, XIANGWO_RELAY_FAILURES_BEFORE_SWITCH),
    cooldownMs: parseMs(env.XIANGWO_RELAY_COOLDOWN_MS, XIANGWO_RELAY_COOLDOWN_DEFAULT_MS),
    candidatesEnv: env.XIANGWO_RELAY_CANDIDATES,
    // 缺省落盘到 `~/.xiangwo/relay-lastgood.json`；显式给 0/off/none = 不落盘
    stateFile: (() => {
      const raw = (env.XIANGWO_RELAY_STATE_FILE ?? '').trim();
      if (raw === '') return undefined;
      if (['0', 'off', 'false', 'no', 'none'].includes(raw.toLowerCase())) return null;
      return raw;
    })(),
  });
}
