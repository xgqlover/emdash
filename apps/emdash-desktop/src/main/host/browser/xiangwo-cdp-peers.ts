// [XG-CUSTOM] 内嵌浏览器 CDP 桥的「来源白名单」：本机回环 + 自动探测的虚拟组网网段。
//
// ── 为什么需要 ────────────────────────────────────────────────────────────────
// 桥要**对外监听**（0.0.0.0:9223）才能让另一台机器上的 agent 直接连
// `http://<本机组网IP>:9223` —— 用户明确不接受「装完还要手工 netsh portproxy + 防火墙规则」。
// 但对外监听不等于"对所有人开"：DevTools 端口没有鉴权（与 Chrome 自带 9222 一致），
// 谁连上谁就能操作内嵌浏览器。所以缺省是：**听 0.0.0.0，但在连接层按来源 IP 过滤**
// （见 xiangwo-cdp-bridge.ts 的 handleConnection）：
//   - 永远放行本机回环 `127.0.0.0/8` + `::1`（本机 agent 完全不受影响）
//   - 自动放行「虚拟组网」接口的网段：
//       ZeroTier  = 接口名（**先转小写**）`^zt` / 含 `zerotier` / 含 `zero tier`
//                   （Linux `ztu7tmyt7w`、Windows `ZeroTier One [xxxxxxxx]`、`ZTN…`）
//                   → 用 `地址 & 掩码` 算出 CIDR（如 10.239.5.0/24）
//       tailscale = 接口名含 `tailscale`/`tail scale`，**或地址**落在 `100.64.0.0/10`
//                   → 固定放行 **整个 /10**
//                   （tailnet 是 /10 大网段；用网卡自带的 /32 掩码只会放行本机自己，等于没用）
//   - **地址兜底**（名字全不命中时的最后一道，见下方 collectXiangwoCdpAllowedPeers）
//   - 可用 `XIANGWO_CDP_ALLOW`（逗号分隔 CIDR）**整体覆盖**自动探测，便于换网段/临时收紧
//   - 探测明细（每个网卡的名字/地址/掩码/mac/判定）一律进 `report`，由桥打进启动日志 ——
//     2026-09-30 真机反馈「Windows 上 ZeroTier 来源被拒」时就是因为缺这份日志没法一眼定位。
//
// ── 为什么不能靠 MAC 认 ZeroTier ─────────────────────────────────────────────
// ZeroTier 自己的 `node/MAC.hpp` 里，虚拟网卡 MAC 的第一个字节是 `(nwid & 0xfe) | 0x02`
// —— 只有"本地管理位"是固定的，**没有固定 OUI**，还跟 Docker(02:42:…)、各种虚拟网卡撞位。
// 所以 MAC 只作为日志证据（`report[].mac`），不参与放行判断。
//
// ── 故意不做的两件事（别当遗漏）──────────────────────────────────────────────
// 1) 不自动放行组网接口上的 IPv6：ZeroTier/tailscale 的实际连通地址都是 IPv4，
//    而接口上那些 IPv6 多是 `fe80::` link-local **/64** —— 按段放行比 IPv4 /24 宽得多，
//    属于"顺手把门开大"，不做。`::1` 单独字面量放行。
// 2) 不支持在 `XIANGWO_CDP_ALLOW` 里写 IPv6 CIDR（只解析 IPv4 CIDR + 字面量 `::1`）；
//    真需要时再按 BigInt 补齐地址比较。
import { createSocket as createUdpSocket } from 'node:dgram';
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** `os.networkInterfaces()` 的形状（单测注入用） */
export type XiangwoCdpNetworkInterfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** [XG-CUSTOM] 监听模式：auto（缺省，0.0.0.0 + 来源过滤）/ local（只 127.0.0.1）/ off（不监听） */
export type XiangwoCdpBindMode = 'auto' | 'local' | 'off';

/** 一个"允许来源"：CIDR（IPv4）或字面量（IPv6 `::1`）+ 来源标签（日志/排查用） */
export type XiangwoCdpAllowedPeer = {
  cidr: string;
  family: 'IPv4' | 'IPv6';
  /** `本机回环` / 网卡名（如 `ztu7tmyt7w`、`tailscale0`）/ `XIANGWO_CDP_ALLOW` */
  label: string;
};

/** tailscale 的 CGNAT 网段：tailnet 里所有节点都在这个 /10 内 */
export const XIANGWO_CDP_TAILSCALE_CIDR = '100.64.0.0/10';

/** 对外监听地址（`bind: 'auto'`）：谁来连由下面的来源白名单决定，不靠绑定地址收口 */
export const XIANGWO_CDP_ANY_HOST = '0.0.0.0';

/** `100.64.0.0 >>> 22`（/10 的网络前缀键；判断"是不是 tailnet 地址"只比这一个数） */
const TAILSCALE_PREFIX_KEY = 401;

/** 永远放行的本机来源 */
export const XIANGWO_CDP_LOOPBACK_PEERS: readonly XiangwoCdpAllowedPeer[] = [
  { cidr: '127.0.0.1/8', family: 'IPv4', label: '本机回环' },
  { cidr: '::1', family: 'IPv6', label: '本机回环' },
];

/** [XG-CUSTOM] `XIANGWO_CDP_BIND` → 监听模式（认不出来的值一律当 auto，保证"装完即用"） */
export function resolveXiangwoCdpBindMode(raw: string | undefined): XiangwoCdpBindMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (['off', '0', 'false', 'no', 'none'].includes(value)) return 'off';
  if (['local', 'loopback', '127.0.0.1', '::1'].includes(value)) return 'local';
  return 'auto';
}

/** [XG-CUSTOM] `XIANGWO_CDP_ALLOW` → CIDR 串数组（空/未设 → 空数组 = 走自动探测） */
export function parseXiangwoCdpAllowList(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** [XG-CUSTOM] Windows 入站防火墙提示（非 Windows → null）。首次运行必须让用户点【允许】。 */
export function windowsFirewallHint(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return null;
  return (
    '首次运行 Windows 会弹「防火墙已阻止此应用的部分功能」——请勾上【专用网络】并点【允许访问】，' +
    '否则远端连不上 9223（不点也不报错，远端只是静默连不上）'
  );
}

/** ZeroTier / tailscale 的网卡名（Linux `ztu7tmyt7w`/`tailscale0`，Windows `ZeroTier One [..]`/`Tailscale`） */
export function isVirtualNetworkInterface(name: string): boolean {
  return virtualInterfaceKind(name) !== null;
}

/** 命中的是哪一种组网（`null` = 名字不像组网网卡） */
export function virtualInterfaceKind(name: string): 'zerotier' | 'tailscale' | null {
  const lower = name.toLowerCase();
  if (lower.includes('tailscale') || lower.includes('tail scale')) return 'tailscale';
  if (lower.includes('zerotier') || lower.includes('zero tier')) return 'zerotier';
  if (/^zt/.test(lower)) return 'zerotier'; // Linux ztu7tmyt7w / Windows 可能的 ZT… / ZTN…
  return null;
}

/** IPv4 是否落在 tailscale 的 100.64.0.0/10 里 */
export function isTailscaleAddress(address: string): boolean {
  const value = ipv4ToInt(address);
  return value !== null && value >>> 22 === TAILSCALE_PREFIX_KEY;
}

/**
 * [XG-CUSTOM] 这个来源地址允许连桥吗？
 * 归一化后：`::1` 字面量放行；IPv4 按 `allowed` 里的 CIDR 逐个比（含 `::ffff:` 映射地址）。
 */
export function isPeerAllowed(
  address: string | undefined,
  allowed: readonly XiangwoCdpAllowedPeer[]
): boolean {
  const normalized = normalizePeerAddress(address);
  if (normalized === null) return false;
  if (normalized === '::1') {
    return allowed.some((peer) => peer.family === 'IPv6' && peer.cidr === '::1');
  }
  const value = ipv4ToInt(normalized);
  if (value === null) return false;
  return allowed.some((peer) => {
    if (peer.family !== 'IPv4') return false;
    const parsed = parsePeerCidr(peer.cidr);
    if (parsed === null) return false;
    const mask = maskOfPrefix(parsed.prefix);
    return (value & mask) >>> 0 === parsed.base;
  });
}

/** 日志/403 正文里的人话白名单：`127.0.0.1/8, ::1, 10.239.5.0/24(ztu7tmyt7w)` */
export function formatAllowedPeers(allowed: readonly XiangwoCdpAllowedPeer[]): string {
  return allowed
    .map((peer) => (peer.label === '本机回环' ? peer.cidr : `${peer.cidr}(${peer.label})`))
    .join(', ');
}

export type XiangwoCdpPeerCollectResult = {
  /** 实际生效的允许来源（本机回环 + 组网网段） */
  allowed: XiangwoCdpAllowedPeer[];
  /** 自动探测到（或被 XIANGWO_CDP_ALLOW 覆盖）的组网网段 */
  virtual: XiangwoCdpAllowedPeer[];
  /** 探测到的组网接口地址（日志里给用户填 `XIANGWO_WEBVIEW_CDP_URL` 用） */
  addresses: Array<{ interfaceName: string; address: string; kind: 'zerotier' | 'tailscale' }>;
  /** 给人看的提示：非法 CIDR / 一个组网接口都没探测到 */
  warnings: string[];
  /** 给人看但不算问题的说明（如"启用了地址兜底"） */
  notes: string[];
  /** **每个网卡的判定明细**（名字/地址/掩码/mac/是否回环/判定结果）—— 排障就靠它 */
  report: XiangwoCdpInterfaceReport[];
  /** 名字没命中、但地址像私有网的"候选网段"（用于提示用户设 XIANGWO_CDP_ALLOW） */
  candidates: XiangwoCdpCandidate[];
};

/** 一个网卡的判定明细（只作日志/排障，不参与放行判断） */
export type XiangwoCdpInterfaceReport = {
  interfaceName: string;
  family: string;
  address: string;
  netmask: string;
  mac: string;
  internal: boolean;
  /** 人话判定：`匹配:zerotier(名字) → 10.239.5.0/24` / `跳过（回环）` / `不匹配（物理/其它网卡）` */
  verdict: string;
  /** 命中并进入白名单时的 CIDR */
  cidr?: string;
};

/** 没匹配上、但地址在私有网段里的接口（提示 `XIANGWO_CDP_ALLOW` 用） */
export type XiangwoCdpCandidate = { interfaceName: string; address: string; cidr: string };

/** 判定为"组网候选"的私有网段（只用于日志提示，不自动放行） */
function isPrivateIpv4(value: number): boolean {
  return (
    value >>> 24 === 10 || // 10/8
    value >>> 20 === 0xac1 || // 172.16/12
    value >>> 16 === 0xc0a8 // 192.168/16
  );
}

/**
 * [XG-CUSTOM] 算"实际生效的允许来源"。
 *
 * `allowOverride` 非空（= 用户设了 `XIANGWO_CDP_ALLOW` 且至少有一项合法）时**只用它**，
 * 不再自动探测 —— 便于换网段/临时收紧；本机回环永远附加在后面（本机 agent 不能被锁死）。
 * 若 `XIANGWO_CDP_ALLOW` 一项都不合法 → 记 warning 并回退自动探测（不把用户锁在门外）。
 *
 * `defaultRouteAddress`（默认路由网卡地址，见 `detectDefaultRouteAddress`）只用于**地址兜底**：
 * 一个接口名字都没命中时，如果默认路由网卡**不在 10/8**，就把其它 10/8 接口的网段也放行
 * （ZeroTier 网卡名在部分 Windows 上可能是本地化/改名过的，光靠名字会漏 —— 见文件头）。
 */
export function collectXiangwoCdpAllowedPeers(
  options: {
    interfaces?: XiangwoCdpNetworkInterfaces;
    allowOverride?: readonly string[];
    defaultRouteAddress?: string | null;
  } = {}
): XiangwoCdpPeerCollectResult {
  const warnings: string[] = [];
  const notes: string[] = [];
  const virtual: XiangwoCdpAllowedPeer[] = [];
  const addresses: XiangwoCdpPeerCollectResult['addresses'] = [];
  const report: XiangwoCdpInterfaceReport[] = [];
  const candidates: XiangwoCdpCandidate[] = [];
  let nameMatched = false;

  const override = (options.allowOverride ?? []).map((item) => item.trim()).filter((item) => item);
  if (override.length > 0) {
    for (const raw of override) {
      const parsed = parsePeerCidr(raw);
      if (parsed === null) {
        warnings.push(`XIANGWO_CDP_ALLOW 里的 ${raw} 不是合法 IPv4 CIDR（已忽略）`);
        continue;
      }
      if (virtual.some((peer) => peer.cidr === parsed.cidr)) continue;
      virtual.push({ cidr: parsed.cidr, family: parsed.family, label: 'XIANGWO_CDP_ALLOW' });
    }
    if (virtual.length === 0) {
      warnings.push('XIANGWO_CDP_ALLOW 里没有任何合法项 → 回退到自动探测组网网段');
    }
  }

  if (virtual.length === 0) {
    const interfaces = options.interfaces ?? safeNetworkInterfaces();
    for (const [interfaceName, infos] of Object.entries(interfaces)) {
      for (const info of infos ?? []) {
        // 回环单独由 LOOPBACK_PEERS 覆盖；只认 IPv4（理由见文件头第 1 条）
        if (info.internal) {
          report.push(reportEntry(interfaceName, info, '跳过（回环/内部网卡）'));
          continue;
        }
        if (!isIpv4Family(info.family)) {
          report.push(reportEntry(interfaceName, info, '跳过（非 IPv4）'));
          continue;
        }
        const tailnet = isTailscaleAddress(info.address);
        const nameKind = virtualInterfaceKind(interfaceName);
        if (!tailnet && nameKind === null) {
          const value = ipv4ToInt(info.address);
          const candidateCidr = cidrOfIpv4(info.address, info.netmask);
          if (value !== null && isPrivateIpv4(value) && candidateCidr !== null) {
            candidates.push({ interfaceName, address: info.address, cidr: candidateCidr });
          }
          report.push(reportEntry(interfaceName, info, '不匹配（物理/其它网卡）'));
          continue;
        }
        const kind: 'zerotier' | 'tailscale' = tailnet ? 'tailscale' : (nameKind ?? 'zerotier');
        // tailnet 一律放行整个 /10；其余组网接口用 地址 & 掩码 算它自己的网段
        const cidr = tailnet ? XIANGWO_CDP_TAILSCALE_CIDR : cidrOfIpv4(info.address, info.netmask);
        if (cidr === null) {
          warnings.push(
            `${interfaceName} 的掩码 ${info.netmask} 不是连续掩码（跳过 ${info.address}）`
          );
          report.push(reportEntry(interfaceName, info, `跳过（掩码 ${info.netmask} 不连续）`));
          continue;
        }
        if (nameKind !== null) nameMatched = true;
        if (!virtual.some((peer) => peer.cidr === cidr)) {
          virtual.push({ cidr, family: 'IPv4', label: interfaceName });
        }
        addresses.push({ interfaceName, address: info.address, kind });
        report.push(
          reportEntry(
            interfaceName,
            info,
            `匹配:${kind}(${tailnet ? '地址 100.64/10' : '名字'}) → ${cidr}`,
            cidr
          )
        );
      }
    }

    // ── 地址兜底（只在"名字一个都没命中"时启用）─────────────────────────────
    // 为什么需要：Windows 上 ZeroTier 的适配器名是系统给的友好名，可能是本地化/被改过的
    // （名字匹配会漏），而地址规则（100.64/10）只覆盖 tailscale。用户要求"装完即用"，
    // 所以给一条**有边界**的兜底：只在名字全不命中 + 默认路由网卡不在 10/8 时，
    // 放行其它 10/8 接口的网段（ZeroTier 网络绝大多数配在 10.x；家里/公司网段若是 10.x，
    // 这条规则不生效 → 宁可走日志提示 + XIANGWO_CDP_ALLOW，也不冒然放宽）。
    const defaultRoute = options.defaultRouteAddress ?? null;
    const defaultRouteValue = defaultRoute === null ? null : ipv4ToInt(defaultRoute);
    const fallbackActive =
      !nameMatched &&
      defaultRouteValue !== null &&
      defaultRouteValue >>> 24 !== 10 && // 默认路由（通常是物理网卡/局域网）不在 10/8
      virtual.length >= 0;
    if (fallbackActive) {
      for (const entry of report) {
        if (entry.internal || entry.family !== 'IPv4' || entry.cidr !== undefined) continue;
        const value = ipv4ToInt(entry.address);
        if (value === null || value >>> 24 !== 10) continue;
        const cidr = cidrOfIpv4(entry.address, entry.netmask);
        if (cidr === null || virtual.some((peer) => peer.cidr === cidr)) continue;
        virtual.push({ cidr, family: 'IPv4', label: `${entry.interfaceName}(地址兜底:10/8)` });
        entry.cidr = cidr;
        entry.verdict = '地址兜底:10/8 → ' + cidr;
      }
      if (virtual.length > 0) {
        notes.push(
          `组网网卡一个都没按名字命中 → 启用地址兜底：放行 10.0.0.0/8 接口的网段` +
            `（默认路由网卡 ${defaultRoute} 不在 10/8，所以这些 10.x 接口不可能是主用局域网）`
        );
      }
    }

    if (virtual.length === 0) {
      warnings.push(
        '未探测到 ZeroTier/tailscale 组网接口 —— 远端将连不上，请检查 ZeroTier/tailscale 是否在线' +
          '（或用 XIANGWO_CDP_ALLOW=10.0.0.0/24 手动指定网段）'
      );
    }
  }

  const orderedVirtual = sortPeersForLog(virtual);
  const allowed: XiangwoCdpAllowedPeer[] = [...XIANGWO_CDP_LOOPBACK_PEERS];
  for (const peer of orderedVirtual) {
    if (!allowed.some((existing) => existing.cidr === peer.cidr)) allowed.push(peer);
  }
  return { allowed, virtual: orderedVirtual, addresses, warnings, notes, report, candidates };
}

function reportEntry(
  interfaceName: string,
  info: NetworkInterfaceInfo,
  verdict: string,
  cidr?: string
): XiangwoCdpInterfaceReport {
  return {
    interfaceName,
    family: String(info.family),
    address: info.address,
    netmask: info.netmask,
    mac: info.mac ?? '',
    internal: info.internal === true,
    verdict,
    ...(cidr === undefined ? {} : { cidr }),
  };
}

/**
 * 默认路由网卡的地址（用来判断"哪个接口是主用局域网"）。
 *
 * 做法是 UDP `connect()` 查一次路由表：**不发任何包**，纯本地查表，不需要管理员权限、
 * 不碰注册表、不调 netsh。拿不到（离线/无默认路由）→ `null`（此时不做地址兜底，更安全）。
 */
export function detectDefaultRouteAddress(timeoutMs = 400): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof createUdpSocket> | null = null;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // 已经关了/还没建好：忽略
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      // 必须显式传 'udp4'：不带参数的 createSocket() 会抛（曾经因此静默退化成"永远拿不到默认路由"，
      // 表现就是"地址兜底永远不生效"）
      socket = createUdpSocket('udp4');
      socket.once('error', () => finish(null));
      socket.connect(53, '8.8.8.8', () => {
        try {
          finish(socket?.address().address ?? null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * 日志顺序固定：ZeroTier 网段在前、tailscale 在后（用户主力是 ZeroTier）。
 * `os.networkInterfaces()` 的键顺序随系统变（这台机器 tailscale0 在 ztu* 前面），
 * 不排一下每次启动的日志都不一样，没法照着核对。
 */
function sortPeersForLog(peers: readonly XiangwoCdpAllowedPeer[]): XiangwoCdpAllowedPeer[] {
  const rank = (peer: XiangwoCdpAllowedPeer): number =>
    /tailscale/i.test(peer.label) || peer.cidr === XIANGWO_CDP_TAILSCALE_CIDR ? 1 : 0;
  return [...peers].sort((a, b) => rank(a) - rank(b));
}

/** 日志里推荐给远端填的地址：优先 ZeroTier（用户主力），退第一个探测到的组网地址 */
export function preferredRemoteAddress(
  addresses: readonly { address: string; kind: 'zerotier' | 'tailscale' }[]
): string | null {
  return (
    addresses.find((item) => item.kind === 'zerotier')?.address ?? addresses[0]?.address ?? null
  );
}

// ── IPv4 / CIDR 小工具 ────────────────────────────────────────────────────────

/**
 * `os.networkInterfaces()` 的 `family` 在 Node ≥18.4 是 `'IPv4'`，但历史上（Node 18.0、
 * 个别平台/打包运行时）会返回数字 `4` —— 认错就等于"一个组网接口都探测不到"，
 * 而这条路径只在 Windows 上真正跑，所以两种都认。
 */
function isIpv4Family(family: NetworkInterfaceInfo['family']): boolean {
  return family === 'IPv4' || (family as unknown as number) === 4;
}

type ParsedCidr = { cidr: string; family: 'IPv4' | 'IPv6'; base: number; prefix: number };

const ALL_ONES = 0xffffffff;

function maskOfPrefix(prefix: number): number {
  return prefix <= 0 ? 0 : (ALL_ONES << (32 - prefix)) >>> 0;
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/** 连续掩码（255.255.255.0）才认；非连续（255.0.255.0）返回 false，别拿它算错网段 */
function isContiguousMask(mask: number): boolean {
  const inverted = ~mask >>> 0;
  return ((inverted + 1) & inverted) === 0;
}

function popcount32(value: number): number {
  let rest = value >>> 0;
  let count = 0;
  while (rest !== 0) {
    count += rest & 1;
    rest >>>= 1;
  }
  return count;
}

/** `10.239.5.174` + `255.255.255.0` → `10.239.5.0/24`（掩码非连续 → null） */
function cidrOfIpv4(address: string, netmask: string): string | null {
  const value = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (value === null || mask === null || !isContiguousMask(mask)) return null;
  const prefix = popcount32(mask);
  return `${intToIpv4((value & mask) >>> 0)}/${prefix}`;
}

/** `10.239.5.174/24` / `10.239.5.174` / `::1` → 规范化条目（认不出来 → null） */
function parsePeerCidr(text: string): ParsedCidr | null {
  const raw = text.trim();
  if (raw === '::1') return { cidr: '::1', family: 'IPv6', base: 0, prefix: 128 };
  const [addressPart = '', prefixPart] = raw.split('/', 2);
  const value = ipv4ToInt(addressPart.trim());
  if (value === null) return null;
  let prefix = 32;
  if (prefixPart !== undefined) {
    const trimmed = prefixPart.trim();
    if (!/^\d{1,2}$/.test(trimmed)) return null;
    prefix = Number(trimmed);
    if (prefix > 32) return null;
  }
  const mask = maskOfPrefix(prefix);
  return {
    cidr: `${intToIpv4((value & mask) >>> 0)}/${prefix}`,
    family: 'IPv4',
    base: (value & mask) >>> 0,
    prefix,
  };
}

/**
 * 归一化对端地址：小写、去 IPv6 zone（`fe80::1%eth0`）、`::ffff:127.0.0.1` → `127.0.0.1`。
 * 认不出来（空/非字符串）→ null（一律当"拒绝"）。
 */
function normalizePeerAddress(address: string | undefined): string | null {
  if (typeof address !== 'string') return null;
  let value = address.trim().toLowerCase();
  if (value === '') return null;
  const zone = value.indexOf('%');
  if (zone > 0) value = value.slice(0, zone);
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  if (value === '0:0:0:0:0:0:0:1') return '::1';
  return value;
}

function safeNetworkInterfaces(): XiangwoCdpNetworkInterfaces {
  try {
    return osNetworkInterfaces();
  } catch {
    return {};
  }
}
