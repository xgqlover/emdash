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
 */

export const DEFAULT_DOH_TEMPLATE = 'https://xg.xgqsxsj.dpdns.org/dns-query';

/** `XIANGWO_DOH` 取这些值 = 完全关掉（开关不加、`configureHostResolver` 也不调）。 */
const DOH_OFF_VALUES = new Set(['0', 'off']);

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
};

/** 把上面的开关真的 append 上去（必须在 `app.whenReady()` 之前调用）。 */
export function configureDohCommandLine({
  commandLine,
  env = process.env,
  warn = (message: string) => console.warn(message),
}: ConfigureDohCommandLineOptions): void {
  const { switches, warning } = resolveDohCommandLineSwitches(env);
  for (const { name, value } of switches) commandLine.appendSwitch(name, value);
  if (warning !== null) warn(`[XG-CUSTOM] ${warning}`);
}

type HostResolverApp = {
  configureHostResolver(options: { secureDnsMode: 'secure'; secureDnsServers: string[] }): void;
};

type ConfigureDohHostResolverOptions = {
  app: HostResolverApp;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
};

/**
 * 真正让内嵌浏览器用我们 DoH 的那一步 —— `app.configureHostResolver`。
 * **必须在 `app.whenReady()` 之后调用**（Electron 文档明说 after the `ready` event），
 * 落点：`src/main/bootstrap/boot/phases/prepare-electron.ts`（boot 第一个 phase，建窗口之前）。
 */
export function configureDohHostResolver({
  app,
  env = process.env,
  warn = (message: string) => console.warn(message),
}: ConfigureDohHostResolverOptions): void {
  const { template, warning } = resolveDohCommandLineSwitches(env);
  if (warning !== null) warn(`[XG-CUSTOM] ${warning}`);
  if (template === null) return; // XIANGWO_DOH=0 / off：一条也不配（零回归）

  if (typeof app.configureHostResolver !== 'function') {
    warn('[XG-CUSTOM] app.configureHostResolver 不可用，DoH 没能配上（内嵌浏览器仍走系统解析器）');
    return;
  }
  try {
    app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [template] });
  } catch (error) {
    warn(`[XG-CUSTOM] app.configureHostResolver 失败，DoH 没配上：${String(error)}`);
  }
}
