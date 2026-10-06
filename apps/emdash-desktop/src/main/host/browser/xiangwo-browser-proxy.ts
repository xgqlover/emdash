// [XG-CUSTOM] 内嵌浏览器（per-profile session）的 socks5 代理解析。
//
// 用途：Windows 客户端上的内嵌浏览器要借道 Linux 主机的 `socks5-proxy.py`（1080，走三线分流）
// 才能上外网；emdash 内嵌浏览器是按 session 设代理的（见 browser-profile-session.ts）。
//
// Windows 上这个配置**原来只能靠进程环境变量**，而 Windows 的 emdash 通常是"启动项/快捷方式"
// 拉起来的 —— 环境变量很容易丢，丢了浏览器就直连（等于没代理），而且用户看不出原因。
// 所以这里补两个来源，并按优先级解析：
//   1. 环境变量 `XIANGWO_BROWSER_PROXY`（保持旧行为；`off`/`none`/`direct` = 显式**直连**；
//      **`system`/`auto` = 跟随系统代理** —— 见下面 [XG-CUSTOM] 2026-10-06 那条）
//   2. userData 里的 `xiangwo-browser-proxy.json`（`{"proxy":"socks5://10.239.5.174:1080"}`；
//      同样支持 `"off"`）—— 打包后不用改快捷方式也能配
//   3. 非 Linux 平台（Windows/macOS 客户端）缺省 `socks5://10.239.5.174:1080`（**ZeroTier** IP）
//      [XG-CUSTOM] 2026-10-06 —— 这里原来写的是 Tailscale IP `100.125.4.119`，并附了一句
//      「10.239.5.174 是旧的 ZeroTier 地址，已失效」。**那句是错的，实测正好相反**
//      （Windows → Linux 各 12 次：`10.239.5.174:1080` = 12/12 成功、平均 6ms；
//       `100.125.4.119:1080` = 0/12 全部超时 —— `tailscale status` 显示走美国 Denver 中继）。
//      ⚠️ 别再改回 Tailscale：Windows 上会 `ERR_SOCKS_CONNECTION_FAILED`（真机事故 10-05）。
//      与 `main/bootstrap/boot/wiring.ts` 的候选顺序（10.239.5.174 > tailscale）保持一致。
//      Linux 本机（代理就在本机、浏览器直连本就正常）**不设缺省**，避免代理没跑时把浏览器搞死。
// 任何异常（文件读不到/坏 JSON/值不合法）都只打日志、返回 undefined —— 绝不因为变量缺失而崩。
//
// [XG-CUSTOM] 2026-10-06 —— **三种语义显式化**（用户问「要不要把 emdash 原代码能力加回来」，查证结果如下）：
//   · **上游 emdash 浏览器侧没有任何代理代码**（`git show origin/main:…/browser-profile-session.ts` 里
//     搜不到 `proxy`）⇒ 上游内嵌浏览器就是 **Electron 缺省 = 跟随系统代理**。
//   · 我们 fork 反而**多加了**：非 Linux（Windows/macOS）**缺省强制** `socks5://10.239.5.174:1080`
//     ⇒ **会把用户 Windows 上那套本来能上外网的代理/梯子架空**（"搜国外网搜不动"的一个主因）。
//   · 而且旧代码把 `off` 当成"不调 setProxy" ⇒ 那其实也是**跟随系统** —— 说一套做一套（已修）。
//   ⇒ 现在：`off/none/direct` = **真直连**（`setProxy({mode:'direct'})`）；
//           `system/auto/default/os/sys` = **跟随系统**（`setProxy({mode:'system'})`，= 上游行为）；
//           `socks5://…`/`http://…` = 走该规则；**什么都不配且非 Linux** = 仍是我们那条 socks5 缺省
//           （要不要把它改成"系统优先、没有才回落"是另一个决定，见 OPS「出网」一节）。

export const XIANGWO_BROWSER_PROXY_ENV = 'XIANGWO_BROWSER_PROXY';

/** userData 下的配置文件（打包后用户手写，不用改环境变量） */
export const XIANGWO_BROWSER_PROXY_FILE = 'xiangwo-browser-proxy.json';

/** 非 Linux 客户端的缺省代理（Linux 主机上的 socks5-proxy.py）
 *  [XG-CUSTOM] 2026-10-06 —— **改成 ZeroTier 地址**：Windows → Linux 各 12 次实测，
 *  `10.239.5.174:1080` = 12/12 成功（平均 6ms），原来的 `100.125.4.119:1080`（Tailscale）= 0/12 全超时。
 *  改的只是**非 Linux 平台**的缺省；用户手写的配置文件 / `XIANGWO_BROWSER_PROXY` 环境变量优先级不变。
 */
export const XIANGWO_BROWSER_PROXY_DEFAULT = 'socks5://10.239.5.174:1080';

/** 显式"不用代理"的取值 —— 语义 = **直连**（`setProxy({mode:'direct'})`），不是"跟随系统" */
const DISABLED_PROXY_VALUES = new Set(['', 'off', 'none', 'direct', 'no', '0', 'false']);

/** [XG-CUSTOM] 2026-10-06 显式"跟随系统代理"的取值（**上游 emdash 的原始行为**） */
const SYSTEM_PROXY_VALUES = new Set(['system', 'auto', 'default', 'os', 'sys']);

export type XiangwoBrowserProxySource = 'env' | 'file' | 'default';

/** [XG-CUSTOM] 2026-10-06 三种**显式**语义（别再靠"不调 setProxy"暗示，Electron 的缺省是 system）： */
export type XiangwoBrowserProxyMode =
  /** 走我们给的代理规则（`setProxy({ proxyRules })`） */
  | 'proxy'
  /** **直连**（`setProxy({ mode: 'direct' })`）—— `off/none/direct` 是**这个**，不是"跟随系统" */
  | 'direct'
  /** **跟随系统代理**（`setProxy({ mode: 'system' })`）—— 上游 emdash 的原始行为（它根本没有代理代码） */
  | 'system';

export type XiangwoBrowserProxySettings = {
  /** `mode === 'proxy'` 时的 Electron `proxyRules` 串；其它模式为 undefined */
  proxy: string | undefined;
  /** 见 `XiangwoBrowserProxyMode`（**必填**，调用方必须显式处理三种语义） */
  mode: XiangwoBrowserProxyMode;
  source: XiangwoBrowserProxySource;
};

export type XiangwoBrowserProxyDeps = {
  env?: (name: string) => string | undefined;
  platform?: NodeJS.Platform;
  /** 读 userData 里的配置文件内容（不存在 → undefined） */
  readConfigFile?: (fileName: string) => string | undefined;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
};

type ProxyValue =
  | { kind: 'proxy'; proxy: string }
  | { kind: 'disabled' }
  | { kind: 'system' }
  | { kind: 'invalid' };

function classifyProxyValue(value: unknown): ProxyValue {
  if (typeof value !== 'string') return { kind: 'invalid' };
  const proxy = value.trim();
  if (proxy === '') return { kind: 'invalid' };
  const lower = proxy.toLowerCase();
  if (DISABLED_PROXY_VALUES.has(lower)) return { kind: 'disabled' };
  // [XG-CUSTOM] 2026-10-06 「跟随系统代理」—— 上游 emdash 的原始行为；对"Windows 上已有一套能上外网的代理"
  //   的人这才是对的（我们的 socks5 缺省会把它架空，见文件头）。
  if (SYSTEM_PROXY_VALUES.has(lower)) return { kind: 'system' };
  // 代理规则串不能带空白/换行（Electron 会解析失败）
  if (/\s/.test(proxy)) return { kind: 'invalid' };
  return { kind: 'proxy', proxy };
}

/** 读配置文件（JSON `{"proxy":"…"}` 或直接写一行代理/`off`） */
function readConfigValue(raw: string): unknown {
  const text = raw.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return (parsed as { proxy?: unknown }).proxy;
    }
    return parsed;
  } catch {
    return text;
  }
}

function fromConfigFile(deps: XiangwoBrowserProxyDeps): XiangwoBrowserProxySettings | undefined {
  const read = deps.readConfigFile;
  if (read === undefined) return undefined;
  let raw: string | undefined;
  try {
    raw = read(XIANGWO_BROWSER_PROXY_FILE);
  } catch (error) {
    deps.log?.('内嵌浏览器代理配置文件读取失败，忽略', {
      file: XIANGWO_BROWSER_PROXY_FILE,
      error: String(error),
    });
    return undefined;
  }
  if (raw === undefined) return undefined;
  const value = classifyProxyValue(readConfigValue(raw));
  if (value.kind === 'disabled') return { proxy: undefined, mode: 'direct', source: 'file' };
  if (value.kind === 'system') return { proxy: undefined, mode: 'system', source: 'file' };
  if (value.kind === 'invalid') {
    deps.log?.('内嵌浏览器代理配置无效，忽略', { file: XIANGWO_BROWSER_PROXY_FILE });
    return undefined;
  }
  return { proxy: value.proxy, mode: 'proxy', source: 'file' };
}

/**
 * [XG-CUSTOM] 2026-10-06 —— **判"系统里到底有没有代理"**（喂 Electron `ses.resolveProxy(url)` 的结果串）。
 *
 * 为什么要判：用户 Windows 上**很可能已经有**一套能上外网的代理/梯子，而上游 emdash 的内嵌浏览器
 * 是"跟随系统代理"（它浏览器侧没有代理代码）。我们以前的缺省硬把流量拽到 Linux 的 socks5，等于把它架空。
 * 现在缺省改成「**系统有代理就跟随系统；没有才回落我们那条 socks5**」——判定就在这个纯函数里。
 *
 * `resolveProxy` 的返回形态（Electron 文档 / 实测）：
 *   `"DIRECT"` · `"PROXY 127.0.0.1:7890"` · `"SOCKS5 127.0.0.1:1080"` · `"PROXY a:1; PROXY b:2"` · `"DIRECT; PROXY c:3"`
 * 语义：**只要有一段不是 DIRECT，就算"系统配了代理"**。
 */
export function systemProxyIsConfigured(probe: unknown): boolean {
  const text = typeof probe === 'string' ? probe.trim() : '';
  if (text === '') return false;
  return text
    .split(';')
    .map((part) => part.trim().toUpperCase())
    .some((part) => part !== '' && part !== 'DIRECT');
}

/**
 * [XG-CUSTOM] 2026-10-06 —— 「**系统代理优先，没有才回落我们的缺省**」（用户 2026-10-06 拍板 B）。
 *
 * 只对 `source === 'default'`（即**什么都没显式配**）生效：
 *   · 环境变量 / 配置文件配过（`env` / `file`）→ **原样返回**，显式永远赢；
 *   · 系统有代理 → 改成 `mode: 'system'`（Electron 跟随系统 = 上游行为）；
 *   · 系统没代理 → 保留我们的 socks5 缺省（不与改动前的行为分叉）。
 */
export function applySystemFirstDefault(
  settings: XiangwoBrowserProxySettings | undefined,
  systemHasProxy: boolean
): XiangwoBrowserProxySettings | undefined {
  if (settings === undefined) return undefined;
  if (settings.source !== 'default') return settings;
  if (!systemHasProxy) return settings;
  return { proxy: undefined, mode: 'system', source: 'default' };
}

/**
 * 解析内嵌浏览器代理（见文件头优先级）。
 * @param deps 依赖（单测注入；缺省读 process.env / process.platform）
 * @returns `undefined` = 什么都没配（直连）；`proxy: undefined` = 显式关闭（直连，且不套缺省）
 */
export function resolveXiangwoBrowserProxy(
  deps: XiangwoBrowserProxyDeps = {}
): XiangwoBrowserProxySettings | undefined {
  const env = (deps.env ?? ((name: string) => process.env[name]))(XIANGWO_BROWSER_PROXY_ENV);
  if (typeof env === 'string' && env.trim() !== '') {
    const value = classifyProxyValue(env);
    if (value.kind === 'disabled') {
      deps.log?.('内嵌浏览器代理被显式关闭（直连，环境变量）', { env: XIANGWO_BROWSER_PROXY_ENV });
      return { proxy: undefined, mode: 'direct', source: 'env' };
    }
    if (value.kind === 'system') {
      deps.log?.('内嵌浏览器代理=跟随系统（环境变量）', { env: XIANGWO_BROWSER_PROXY_ENV });
      return { proxy: undefined, mode: 'system', source: 'env' };
    }
    if (value.kind === 'invalid') {
      deps.log?.('内嵌浏览器代理取值无效，忽略', { env: XIANGWO_BROWSER_PROXY_ENV });
    } else {
      return { proxy: value.proxy, mode: 'proxy', source: 'env' };
    }
  }
  const fromFile = fromConfigFile(deps);
  if (fromFile !== undefined) return fromFile;
  if ((deps.platform ?? process.platform) !== 'linux') {
    return { proxy: XIANGWO_BROWSER_PROXY_DEFAULT, mode: 'proxy', source: 'default' };
  }
  return undefined;
}
