// [XG-CUSTOM] 2026-10-03 工具窗口（WeKnora / AFFiNE / Kaneo / T8 / OpenViking）的**地址解析**（主进程唯一权威）。
//
// 背景（2026-10-03 实测 AFFiNE 案）：这五个窗口原来都是
//     `const url = (await services.forwardManualPreview(port)) ?? 'http://127.0.0.1:<port>'`
// —— **Linux 上 emdash 客户端 == 主机**，"回落地址"正好就是那台服务，所以**回落也能用**；
// Windows 客户端上 127.0.0.1 是**客户端自己**（不是主机）→ SSH 隧道一失败窗口就白屏，
// 看着像"这个功能根本没打包进 exe"（实际：代码在、网络也通，只是加载了一个死地址）。
//
// 解析顺序（照 host/xiangwo-chat-target.ts 已验证的范式）：
//   1. 有远程主机（且不是 loopback）→ 先复用 emdash 的 SSH 端口转发
//      （preview-servers/port-forward-service，即 `services.forwardManualPreview`）；
//   2. 隧道不可用 / 超时 → **直连主机地址** `http://<host>:<port><path>`
//      （这些服务在主机上都监听 0.0.0.0；实测 Windows 经 ZeroTier 直连 3010/9037/5180/18766 全部 200）；
//   3. 没有远程主机（或主机就是 loopback）→ 本机 `http://127.0.0.1:<port><path>`（旧行为）；
//   4. **任何异常**都回落本机 —— 绝不让"客户端 == 主机"这条路变坏。
//
// 本模块**不 import electron**（纯逻辑，单测零依赖）；真实依赖在
// bootstrap/boot/phases/services.ts 里注入（`firstRemoteHost` + `forwardManualPreview`）。

import { isLoopbackHost, isUsableHostAddress, stripTrailingSlash } from './xiangwo-chat-target';

/** 解析来源（排查/日志用） */
export type ToolWindowSource = 'tunnel' | 'host' | 'local';

export type ToolWindowTarget = {
  /** 可直接 `loadURL` 的地址 */
  url: string;
  source: ToolWindowSource;
};

/** 依赖注入口（便于单测；services.ts 里注入真实实现）。全部可选：缺失一律按"没有远程主机"处理。 */
export type ToolWindowTargetDeps = {
  /** 当前主机候选：emdash 的第一条 SSH 远程连接（无远程主机 → undefined/null） */
  activeRemoteHost?: () => { connectionId: string; host: string } | undefined | null;
  /** 复用 emdash 的 SSH 端口转发，返回本地可访问的基址（失败 → null） */
  forwardRemotePort?: (remotePort: number) => Promise<string | null>;
  /** 隧道等待上限（缺省 5000ms；超时就直连主机地址，绝不让窗口卡住） */
  tunnelTimeoutMs?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

/** 把 path 归一化成 "" 或 "/xxx"（无尾斜杠）；`''`/`'/'`/`undefined` 都当空路径 */
export function normalizeToolPath(path: string | undefined): string {
  const value = (path ?? '').trim();
  if (value === '' || value === '/') return '';
  const withLead = value.startsWith('/') ? value : `/${value}`;
  return stripTrailingSlash(withLead);
}

/** 主机地址能不能当 URL 的 authority 用（IPv6 加方括号） */
export function toolAuthority(host: string): string {
  const value = host.trim();
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}

/** 本机地址（"客户端 == 主机"时的正确地址 = 旧行为） */
export function localToolUrl(remotePort: number, path?: string): string {
  return `http://127.0.0.1:${String(remotePort)}${normalizeToolPath(path)}`;
}

/** 超时就不等隧道了（底层 promise 继续跑，最多留一条空闲隧道，无害） */
function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
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
 * 纯解析（不缓存）：单测直接调它。**永不抛异常**。
 */
export async function computeToolWindowTarget(
  remotePort: number,
  path: string | undefined = '/',
  deps: ToolWindowTargetDeps = {}
): Promise<ToolWindowTarget> {
  const local = (): ToolWindowTarget => ({ url: localToolUrl(remotePort, path), source: 'local' });
  let host: { connectionId: string; host: string } | undefined | null;
  try {
    host = deps.activeRemoteHost?.() ?? undefined;
  } catch (error) {
    deps.log?.('读取当前主机失败，工具窗口回落本机', { remotePort, error: String(error) });
    return local();
  }
  if (host === undefined || host === null || isLoopbackHost(host.host)) return local();

  const forward = deps.forwardRemotePort;
  if (forward !== undefined) {
    try {
      const forwarded = await raceTimeout(forward(remotePort), deps.tunnelTimeoutMs ?? 5000);
      const base = typeof forwarded === 'string' ? stripTrailingSlash(forwarded) : '';
      if (base !== '') {
        deps.log?.('工具窗口走 SSH 转发', { remotePort, host: host.host, baseUrl: base });
        return { url: `${base}${normalizeToolPath(path)}`, source: 'tunnel' };
      }
    } catch (error) {
      deps.log?.('SSH 转发失败，改用主机地址直连', {
        remotePort,
        host: host.host,
        error: String(error),
      });
    }
  }
  if (isUsableHostAddress(host.host)) {
    deps.log?.('工具窗口直连主机', { remotePort, host: host.host });
    return {
      url: `http://${toolAuthority(host.host)}:${String(remotePort)}${normalizeToolPath(path)}`,
      source: 'host',
    };
  }
  deps.log?.('远程主机地址不可用（隧道也不可用），工具窗口回落本机', {
    remotePort,
    host: host.host,
  });
  return local();
}
