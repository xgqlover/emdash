// [XG-CUSTOM] 内嵌浏览器（per-profile session）的 socks5 代理解析。
//
// 用途：Windows 客户端上的内嵌浏览器要借道 Linux 主机的 `socks5-proxy.py`（1080，走三线分流）
// 才能上外网；emdash 内嵌浏览器是按 session 设代理的（见 browser-profile-session.ts）。
//
// Windows 上这个配置**原来只能靠进程环境变量**，而 Windows 的 emdash 通常是"启动项/快捷方式"
// 拉起来的 —— 环境变量很容易丢，丢了浏览器就直连（等于没代理），而且用户看不出原因。
// 所以这里补两个来源，并按优先级解析：
//   1. 环境变量 `XIANGWO_BROWSER_PROXY`（保持旧行为；`off`/`none`/`direct` = 显式关掉代理）
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

export const XIANGWO_BROWSER_PROXY_ENV = 'XIANGWO_BROWSER_PROXY';

/** userData 下的配置文件（打包后用户手写，不用改环境变量） */
export const XIANGWO_BROWSER_PROXY_FILE = 'xiangwo-browser-proxy.json';

/** 非 Linux 客户端的缺省代理（Linux 主机上的 socks5-proxy.py）
 *  [XG-CUSTOM] 2026-10-06 —— **改成 ZeroTier 地址**：Windows → Linux 各 12 次实测，
 *  `10.239.5.174:1080` = 12/12 成功（平均 6ms），原来的 `100.125.4.119:1080`（Tailscale）= 0/12 全超时。
 *  改的只是**非 Linux 平台**的缺省；用户手写的配置文件 / `XIANGWO_BROWSER_PROXY` 环境变量优先级不变。
 */
export const XIANGWO_BROWSER_PROXY_DEFAULT = 'socks5://10.239.5.174:1080';

/** 显式"不用代理"的取值 */
const DISABLED_PROXY_VALUES = new Set(['', 'off', 'none', 'direct', 'no', '0', 'false']);

export type XiangwoBrowserProxySource = 'env' | 'file' | 'default';

export type XiangwoBrowserProxySettings = {
  /** Electron `ses.setProxy({ proxyRules })` 的取值；**undefined = 显式关闭代理（直连）** */
  proxy: string | undefined;
  source: XiangwoBrowserProxySource;
};

export type XiangwoBrowserProxyDeps = {
  env?: (name: string) => string | undefined;
  platform?: NodeJS.Platform;
  /** 读 userData 里的配置文件内容（不存在 → undefined） */
  readConfigFile?: (fileName: string) => string | undefined;
  log?: (message: string, metadata?: Record<string, unknown>) => void;
};

type ProxyValue = { kind: 'proxy'; proxy: string } | { kind: 'disabled' } | { kind: 'invalid' };

function classifyProxyValue(value: unknown): ProxyValue {
  if (typeof value !== 'string') return { kind: 'invalid' };
  const proxy = value.trim();
  if (proxy === '') return { kind: 'invalid' };
  if (DISABLED_PROXY_VALUES.has(proxy.toLowerCase())) return { kind: 'disabled' };
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
  if (value.kind === 'disabled') return { proxy: undefined, source: 'file' };
  if (value.kind === 'invalid') {
    deps.log?.('内嵌浏览器代理配置无效，忽略', { file: XIANGWO_BROWSER_PROXY_FILE });
    return undefined;
  }
  return { proxy: value.proxy, source: 'file' };
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
      deps.log?.('内嵌浏览器代理被显式关闭（环境变量）', { env: XIANGWO_BROWSER_PROXY_ENV });
      return { proxy: undefined, source: 'env' };
    }
    if (value.kind === 'invalid') {
      deps.log?.('内嵌浏览器代理取值无效，忽略', { env: XIANGWO_BROWSER_PROXY_ENV });
    } else {
      return { proxy: value.proxy, source: 'env' };
    }
  }
  const fromFile = fromConfigFile(deps);
  if (fromFile !== undefined) return fromFile;
  if ((deps.platform ?? process.platform) !== 'linux') {
    return { proxy: XIANGWO_BROWSER_PROXY_DEFAULT, source: 'default' };
  }
  return undefined;
}
