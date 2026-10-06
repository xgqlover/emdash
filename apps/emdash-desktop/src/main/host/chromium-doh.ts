/**
 * [XG-CUSTOM] 2026-10-06 —— 内嵌浏览器改用**我们自己的 DoH**（治假 AAAA `2001::1` 沉洞）。
 *
 * 现场：本机系统解析器对 YouTube/Google 回假 AAAA `2001::1`（`getent hosts` 实测），Chromium
 * 优先 v6 ⇒ `ERR_TIMED_OUT`；指到我们 Worker 的 RFC 8484 出口（answer 段的 AAAA 会被抹掉、
 * 只回真实 A 记录）就正常。实测同一台机器：`curl --max-time 20 https://www.google.com/` → 超时
 * （exit 28），加 `--doh-url https://xg.xgqsxsj.dpdns.org/dns-query` → `HTTP/2 200`。
 *
 * ⚠️ 两条路都铺了，因为**命令行开关在 Electron 40（Chromium 144）上是聋的**（2026-10-06 实测）：
 *   ① 命令行：`--dns-over-https-mode=secure` + `--dns-over-https-templates=<模板>`
 *      —— 必须在 `app.whenReady()` 之前 appendSwitch，所以挂在 `configureChromiumCommandLine()`。
 *      但实测（把模板指到本机 https://127.0.0.1:8443/dns-query 自建 DoH，**一条请求都没收到**；
 *      Electron 40.10.2 二进制里也 grep 不到 `dns-over-https` 这两个开关名；netlog 始终
 *      `secure_dns_mode:0` + `doh_config.servers:[]`）⇒ 现代 Chromium 已经不认它们了。
 *   ② Electron 官方 API：`app.configureHostResolver({ secureDnsMode:'secure', secureDnsServers })`
 *      —— 文档要求 **ready 之后**调用，落点在 `prepare-electron.ts`（boot 的第一个 phase、
 *      建窗口之前）。实测本机 DoH 服务器**收到了** RFC 8484 POST，netlog 变成 `secure_dns_mode:2`
 *      且 `doh_config.servers:[{template:…}]`；指到真 Worker 后 google 3.2s 打开（不带开关时同机 ERR_TIMED_OUT）。
 *  ⇒ **②才是真正生效的那条**；①留着是因为它零成本、且万一哪天 Chromium 又把开关加回来就直接可用。
 *
 * 环境变量（都可回退）：
 *   · `XIANGWO_DOH=0` / `off`      ⇒ **两条路都不配**，逐字节回到改动前（继续走系统解析器）
 *   · `XIANGWO_DOH_TEMPLATE=<url>` ⇒ 覆盖模板（默认见 `DEFAULT_DOH_TEMPLATE`）
 *   · `XIANGWO_DOH_PROBE_MS=<n>`   ⇒ 可达性探测超时（默认 `DOH_PROBE_TIMEOUT_MS`，上限 1500ms）
 *   · `XIANGWO_DOH_PROBE=0` / `off`⇒ 跳过探测，直接按模板配 secure（旧行为，排障用）
 *
 * [XG-CUSTOM] 2026-10-06 —— **第三轮：把"到底有没有生效"变成可读证据 + secure 不许闭死**。
 *   ① 诊断日志：原来只有 `console.warn`，而 Electron 主进程的 `console.warn` **不进**
 *      `~/.config/emdash/logs/emdash.log`（那边只收 pino 的 warn+）⇒ 真机上"跑没跑、跑成什么样"
 *      完全查不到。现在多接一个 `logger` 回调（生产传 `log.warn`，落盘），启动各打一句：
 *      解析结果 / 探测结果 / 最终决策 / `configureHostResolver` 调用前后 / 关闭原因。
 *   ② 可达性探测 + 降级：`secureDnsMode:'secure'` 的语义是**只用 DoH 服务器解析**，
 *      模板一旦不可达就是"DNS 全灭"（比假 AAAA 更糟）。所以启动时先用 1.2s 超时打一发
 *      RFC 8484 查询探活：**不通就不调用 `configureHostResolver`**（保持 Chromium 缺省 =
 *      当前系统解析器；**不退回 `automatic`**，因为 automatic 在 secure 服务器不可达时同样会
 *      静默滑回系统解析器，等于"配了但没配"，还多一份伪证据）。
 *      决策抽成纯函数 `decideDohHostResolverConfig()`（有单测），探测实现 `probeDohReachability()`。
 */

export const DEFAULT_DOH_TEMPLATE = 'https://xg.xgqsxsj.dpdns.org/dns-query';

/** `XIANGWO_DOH` 取这些值 = 完全关掉（开关不加、`configureHostResolver` 也不调）。 */
const DOH_OFF_VALUES = new Set(['0', 'off']);

/** 可达性探测超时：默认 1.2s（启动最多等这么久），硬上限 1.5s（用户要求别阻塞启动更久）。 */
export const DOH_PROBE_TIMEOUT_MS = 1200;
export const DOH_PROBE_TIMEOUT_MAX_MS = 1500;

export type DohCommandLineSwitch = { name: string; value: string };

export type DohPlan = {
  /** 要 append 的开关（按顺序）。关闭时为空数组。 */
  switches: DohCommandLineSwitch[];
  /** 要交给 `app.configureHostResolver` 的 DoH 模板；`null` = 关闭（DoH 整个不配）。 */
  template: string | null;
  /** 非 null = 该 warn 一句（目前只有"模板非法被忽略"）。 */
  warning: string | null;
};

function isUsableDohTemplate(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

/** 环境变量 → DoH 计划（开关列表 + 模板）。**纯函数**：不读 `process.env`、不碰 app、不打印。 */
export function resolveDohCommandLineSwitches(env: NodeJS.ProcessEnv = {}): DohPlan {
  if (DOH_OFF_VALUES.has((env.XIANGWO_DOH ?? '').trim().toLowerCase())) {
    return { switches: [], template: null, warning: null };
  }

  const override = (env.XIANGWO_DOH_TEMPLATE ?? '').trim();
  let template = DEFAULT_DOH_TEMPLATE;
  let warning: string | null = null;
  if (override !== '') {
    if (isUsableDohTemplate(override)) template = override;
    else {
      warning = `XIANGWO_DOH_TEMPLATE 不是可用的 https 模板，已忽略：「${override}」，改用默认 ${DEFAULT_DOH_TEMPLATE}`;
    }
  }

  return {
    switches: [
      { name: 'dns-over-https-mode', value: 'secure' },
      { name: 'dns-over-https-templates', value: template },
    ],
    template,
    warning,
  };
}

type ChromiumCommandLine = {
  appendSwitch(name: string, value?: string): void;
};

type ConfigureDohCommandLineOptions = {
  commandLine: ChromiumCommandLine;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  /** [XG-CUSTOM] 2026-10-06 —— 落盘诊断（生产传 `log.warn`；缺省不打，保持单测/旧调用方零噪音）。 */
  logger?: DohDiagnosticLogger;
};

/** [XG-CUSTOM] 2026-10-06 —— 诊断日志回调（pino 风格：`(message, fields?)`）。 */
export type DohDiagnosticLogger = (message: string, fields?: Record<string, unknown>) => void;

/** 统一前缀：`[XG-CUSTOM] DoH:` —— grep 这一句就能把整条 DoH 链路捞出来。 */
const DOH_LOG_PREFIX = '[XG-CUSTOM] DoH:';
const dohLog = (
  logger: DohDiagnosticLogger | undefined,
  message: string,
  fields?: Record<string, unknown>
): void => {
  if (logger === undefined) return;
  logger(`${DOH_LOG_PREFIX} ${message}`, fields);
};

/** 把上面的开关真的 append 上去（必须在 `app.whenReady()` 之前调用）。 */
export function configureDohCommandLine({
  commandLine,
  env = process.env,
  warn = (message: string) => console.warn(message),
  logger,
}: ConfigureDohCommandLineOptions): void {
  const plan = resolveDohCommandLineSwitches(env);
  for (const { name, value } of plan.switches) commandLine.appendSwitch(name, value);
  if (plan.warning !== null) warn(`[XG-CUSTOM] ${plan.warning}`);
  // [XG-CUSTOM] 2026-10-06 —— 命令行这条是**死开关**（Electron 40 实测），但既然加了就留证据。
  dohLog(logger, '命令行开关（Electron 40 实测为死开关，仅留痕）', {
    enabled: plan.template !== null,
    template: plan.template,
    switches: plan.switches.map((s) => s.name),
  });
}

// ───────────────────────── [XG-CUSTOM] 2026-10-06 可达性探测 + 决策（纯函数）─────────────────────────

/** `probeDohReachability()` 的结果。`ran:false` = 被配置跳过（没探），不是失败。 */
export type DohProbeResult = {
  /** 是否真的发过探测请求。 */
  ran: boolean;
  /** 探测通过（HTTP 2xx + content-type: application/dns-message）。 */
  ok: boolean;
  /** 耗时毫秒（`ran:false` 时为 0）。 */
  ms: number;
  /** 失败/跳过的原因（人话，进日志）。 */
  reason: string;
};

export type DohHostResolverConfig = {
  /** 是否调用 `app.configureHostResolver`。false = 保留 Chromium 缺省（系统解析器）。 */
  configure: boolean;
  /** `configure:true` 时的模式（恒为 secure —— 见文件头"不退回 automatic"的理由）。 */
  mode: 'secure' | null;
  /** `configure:true` 时的模板。 */
  template: string | null;
  /** 给日志/单测看的可判别原因码。 */
  reason:
    | 'disabled-by-env'
    | 'no-template'
    | 'probe-failed'
    | 'probe-skipped-by-env'
    | 'probe-ok'
    | 'probe-not-run';
};

/**
 * [XG-CUSTOM] 2026-10-06 —— **纯函数**：`(解析结果, 探测结果, 环境变量) → 最终决策`。
 * 决策表（判据：**不能让内嵌浏览器 DNS 全灭**）：
 *
 *   | 条件                                    | configure | 结果                       |
 *   |-----------------------------------------|-----------|----------------------------|
 *   | `XIANGWO_DOH=0/off`                     | false     | 完全不配（零回归）         |
 *   | 模板非法/为空（`template===null`）      | false     | 完全不配                   |
 *   | 探测不通（`ran && !ok`）                | false     | 保留系统解析器 + warn      |
 *   | 探测通过（`ran && ok`）                 | true      | `secure` + 我们的模板      |
 *   | 探测被 `XIANGWO_DOH_PROBE=0` 跳过       | true      | `secure`（旧行为，排障用） |
 *   | 探测根本没跑（`!ran` 且非显式跳过）     | false     | 保留系统解析器（宁可不配） |
 */
export function decideDohHostResolverConfig(options: {
  plan: DohPlan;
  probe: DohProbeResult;
  env?: NodeJS.ProcessEnv;
}): DohHostResolverConfig {
  const { plan, probe } = options;
  const env = options.env ?? {};

  if (plan.template === null) {
    const disabledByEnv = DOH_OFF_VALUES.has((env.XIANGWO_DOH ?? '').trim().toLowerCase());
    return {
      configure: false,
      mode: null,
      template: null,
      reason: disabledByEnv ? 'disabled-by-env' : 'no-template',
    };
  }
  if (probe.ran && !probe.ok) {
    return { configure: false, mode: null, template: plan.template, reason: 'probe-failed' };
  }
  if (!probe.ran) {
    const skipped =
      DOH_OFF_VALUES.has((env.XIANGWO_DOH_PROBE ?? '').trim().toLowerCase()) ||
      (env.XIANGWO_DOH_PROBE ?? '').trim() === '0';
    if (!skipped) {
      return { configure: false, mode: null, template: plan.template, reason: 'probe-not-run' };
    }
    return {
      configure: true,
      mode: 'secure',
      template: plan.template,
      reason: 'probe-skipped-by-env',
    };
  }
  return { configure: true, mode: 'secure', template: plan.template, reason: 'probe-ok' };
}

/** 探测超时（毫秒）：默认 1.2s，`XIANGWO_DOH_PROBE_MS` 可调，硬上限 1.5s。 */
export function resolveProbeTimeoutMs(env: NodeJS.ProcessEnv = {}): number {
  const raw = Number.parseInt((env.XIANGWO_DOH_PROBE_MS ?? '').trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return DOH_PROBE_TIMEOUT_MS;
  return Math.min(raw, DOH_PROBE_TIMEOUT_MAX_MS);
}

/** 造一条最小 RFC 8484 查询（`www.google.com` A / RD=1 / EDNS0）——只为探活，不解析回包。 */
function buildProbeQuery(): Uint8Array<ArrayBuffer> {
  const name = 'www.google.com'
    .split('.')
    .flatMap((label) => [label.length, ...Array.from(label, (c) => c.charCodeAt(0))]);
  return Uint8Array.from([
    0x12,
    0x34,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    ...name,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x29,
    0x10,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

/**
 * [XG-CUSTOM] 2026-10-06 —— 模板可达性探测：发一发 RFC 8484 POST（Chromium 用的就是这个格式），
 * 带**硬超时**（`Promise.race`，fetch 不响应也不拖住启动）。
 * 判据：HTTP 2xx **且** `content-type` 含 `application/dns-message`（@2xx 但回 HTML 的门户/劫持不算通）。
 */
export async function probeDohReachability(
  template: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<DohProbeResult> {
  const timeoutMs = options.timeoutMs ?? DOH_PROBE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`探测超时（${timeoutMs}ms）`)), timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(template, {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
        body: buildProbeQuery(),
      }),
      timeout,
    ]);
    const ms = Date.now() - startedAt;
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!response.ok) {
      return { ran: true, ok: false, ms, reason: `HTTP ${response.status}` };
    }
    if (!contentType.includes('application/dns-message')) {
      return {
        ran: true,
        ok: false,
        ms,
        reason: `content-type 不是 application/dns-message（${contentType || '空'}）`,
      };
    }
    return { ran: true, ok: true, ms, reason: 'ok' };
  } catch (error) {
    return { ran: true, ok: false, ms: Date.now() - startedAt, reason: String(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ───────────────────────── [XG-CUSTOM] 2026-10-06 落地（异步：先探测再决策）─────────────────────────

type HostResolverApp = {
  configureHostResolver(options: { secureDnsMode: 'secure'; secureDnsServers: string[] }): void;
};

type ConfigureDohHostResolverOptions = {
  app: HostResolverApp;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  /** 落盘诊断（生产传 `log.warn`）。 */
  logger?: DohDiagnosticLogger;
  /** 注入探测实现（单测用；缺省 = `probeDohReachability`）。 */
  probe?: (template: string, timeoutMs: number) => Promise<DohProbeResult>;
};

/**
 * 真正让内嵌浏览器用我们 DoH 的那一步 —— `app.configureHostResolver`。
 * **必须在 `app.whenReady()` 之后调用**（Electron 文档明说 after the `ready` event），
 * 落点：`src/main/bootstrap/boot/phases/prepare-electron.ts`（boot 第一个 phase，建窗口之前）。
 *
 * [XG-CUSTOM] 2026-10-06 —— 现在是 `async`：先打可达性探测（≤1.5s），按 `decideDohHostResolverConfig()`
 * 的决策表决定配不配。探测不通 ⇒ **不调用** `configureHostResolver`（内嵌浏览器继续走系统解析器 =
 * 当前能用的那条，绝不 DNS 全灭）。
 */
export async function configureDohHostResolver({
  app,
  env = process.env,
  warn = (message: string) => console.warn(message),
  logger,
  probe,
}: ConfigureDohHostResolverOptions): Promise<DohHostResolverConfig> {
  const plan = resolveDohCommandLineSwitches(env);
  if (plan.warning !== null) warn(`[XG-CUSTOM] ${plan.warning}`);

  // 解析结果（可判案第一条）
  dohLog(logger, '解析结果', {
    enabled: plan.template !== null,
    template: plan.template,
    switches: plan.switches.map((s) => s.name),
    doh: env.XIANGWO_DOH ?? null,
    templateOverride: env.XIANGWO_DOH_TEMPLATE ?? null,
  });

  // `XIANGWO_DOH=0` ⇒ 明确打一句"按配置关闭"（不能静默）
  if (plan.template === null) {
    const decision = decideDohHostResolverConfig({
      plan,
      probe: { ran: false, ok: false, ms: 0, reason: '未探测' },
      env,
    });
    dohLog(logger, '按配置关闭（XIANGWO_DOH=0/off）：一条都不配，内嵌浏览器走系统解析器', {
      reason: decision.reason,
    });
    return decision;
  }

  const probeRunner =
    probe ?? ((t: string, timeoutMs: number) => probeDohReachability(t, { timeoutMs }));
  const probeResult = await probeRunner(plan.template, resolveProbeTimeoutMs(env));
  dohLog(logger, probeResult.ok ? '可达性探测通过' : '可达性探测未通过', {
    template: plan.template,
    ran: probeResult.ran,
    ok: probeResult.ok,
    ms: probeResult.ms,
    reason: probeResult.reason,
  });

  const decision = decideDohHostResolverConfig({ plan, probe: probeResult, env });
  dohLog(logger, '最终决策', {
    configure: decision.configure,
    mode: decision.mode,
    template: decision.template,
    reason: decision.reason,
  });

  if (!decision.configure) {
    // 探测不通 / 决策不配：**不调用** configureHostResolver ⇒ 保持 Chromium 缺省（系统解析器）。
    dohLog(
      logger,
      decision.reason === 'probe-failed'
        ? `探测不通（${probeResult.reason}）⇒ 不配 secure（否则 DNS 全灭），内嵌浏览器保持系统解析器`
        : '决策为不配置 ⇒ 保持系统解析器',
      { reason: decision.reason, probeReason: probeResult.reason }
    );
    return decision;
  }

  if (typeof app.configureHostResolver !== 'function') {
    warn('[XG-CUSTOM] app.configureHostResolver 不可用，DoH 没能配上（内嵌浏览器仍走系统解析器）');
    return { ...decision, configure: false, reason: 'probe-ok' };
  }
  try {
    dohLog(logger, '调用 app.configureHostResolver 之前', {
      mode: decision.mode,
      secureDnsServers: [decision.template],
    });
    const returned = app.configureHostResolver({
      secureDnsMode: 'secure',
      secureDnsServers: [decision.template as string],
    });
    dohLog(logger, '调用 app.configureHostResolver 之后（未抛错）', {
      returned: returned === undefined ? 'undefined' : String(returned),
    });
  } catch (error) {
    const original =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : String(error);
    warn(`[XG-CUSTOM] app.configureHostResolver 失败，DoH 没配上：${original}`);
    dohLog(logger, '调用 app.configureHostResolver 抛出异常（DoH 没配上）', { error: original });
    return { ...decision, configure: false };
  }
  return decision;
}
