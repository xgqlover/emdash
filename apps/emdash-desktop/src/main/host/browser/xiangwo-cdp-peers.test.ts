// [XG-CUSTOM] CDP 桥「来源白名单」单测：CIDR 匹配 + 组网网段自动探测 + XIANGWO_CDP_ALLOW 覆盖。
//
// 为什么这组测试重要：桥现在缺省听 0.0.0.0（装完即用），唯一的收口就是这里的白名单。
// 探测错 = 远端连不上（用户场景：ZeroTier 的 10.239.5.0/24）；放太宽 = 别人能操作内嵌浏览器。
import { createSocket as createUdpSocket } from 'node:dgram';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  collectXiangwoCdpAllowedPeers,
  detectDefaultRouteAddress,
  formatAllowedPeers,
  isPeerAllowed,
  isTailscaleAddress,
  isVirtualNetworkInterface,
  parseXiangwoCdpAllowList,
  preferredRemoteAddress,
  resolveXiangwoCdpBindMode,
  virtualInterfaceKind,
  windowsFirewallHint,
  XIANGWO_CDP_LOOPBACK_PEERS,
  type XiangwoCdpNetworkInterfaces,
} from './xiangwo-cdp-peers';

const ZT_INTERFACE = 'ztu7tmyt7w';

function ipv4(address: string, netmask = '255.255.255.0'): NetworkInterfaceInfo {
  return {
    address,
    netmask,
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
  };
}

function ipv6(address: string, netmask = 'ffff:ffff:ffff:ffff::'): NetworkInterfaceInfo {
  return {
    address,
    netmask,
    family: 'IPv6',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    scopeid: 0,
  };
}

/** 老 Node/个别运行时会把 family 报成数字 4（见 isIpv4Family 注释），这里也要认 */
function ipv4NumericFamily(address: string, netmask = '255.255.255.0'): NetworkInterfaceInfo {
  return { ...ipv4(address, netmask), family: 4 as unknown as 'IPv4' };
}

/** 这台机器上的真实现场（Linux 开发机）：ZeroTier 10.239.5.174/24 + tailscale 100.125.4.119/32 */
function realWorldInterfaces(): XiangwoCdpNetworkInterfaces {
  return {
    lo: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      },
      ipv6('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),
    ],
    enp174s0f0: [ipv4('192.168.2.10')],
    tailscale0: [
      ipv4('100.125.4.119', '255.255.255.255'),
      ipv6('fd7a:115c:a1e0::12e:478', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),
    ],
    [ZT_INTERFACE]: [ipv4('10.239.5.174')],
    docker0: [ipv4('172.17.0.1', '255.255.0.0')],
  };
}

function allowedFor(
  interfaces: XiangwoCdpNetworkInterfaces,
  allowOverride?: string[]
): ReturnType<typeof collectXiangwoCdpAllowedPeers> {
  return collectXiangwoCdpAllowedPeers({
    interfaces,
    ...(allowOverride === undefined ? {} : { allowOverride }),
  });
}

describe('[XG-CUSTOM] XIANGWO_CDP_BIND 解析', () => {
  it('缺省/未知 = auto（装完即用，不能默认锁死）', () => {
    for (const raw of [undefined, '', '  ', 'auto', 'AUTO', 'garbage']) {
      expect(resolveXiangwoCdpBindMode(raw)).toBe('auto');
    }
  });

  it('local / off 的各种写法', () => {
    for (const raw of ['local', 'LOCAL', 'loopback', '127.0.0.1']) {
      expect(resolveXiangwoCdpBindMode(raw)).toBe('local');
    }
    for (const raw of ['off', 'OFF', '0', 'false', 'no', 'none']) {
      expect(resolveXiangwoCdpBindMode(raw)).toBe('off');
    }
  });
});

describe('[XG-CUSTOM] XIANGWO_CDP_ALLOW 解析', () => {
  it('逗号分隔、去空白、丢空项', () => {
    expect(parseXiangwoCdpAllowList(undefined)).toEqual([]);
    expect(parseXiangwoCdpAllowList('   ')).toEqual([]);
    expect(parseXiangwoCdpAllowList('10.239.5.0/24, 100.64.0.0/10 ,,')).toEqual([
      '10.239.5.0/24',
      '100.64.0.0/10',
    ]);
  });
});

describe('[XG-CUSTOM] 组网网段自动探测 + 来源匹配', () => {
  it('探测 ZeroTier 网段（地址 & 掩码）与 tailscale /10，忽略普通网卡', () => {
    const plan = allowedFor(realWorldInterfaces());
    expect(plan.virtual.map((peer) => peer.cidr)).toEqual(['10.239.5.0/24', '100.64.0.0/10']);
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.239.5.0/24(ztu7tmyt7w), 100.64.0.0/10(tailscale0)'
    );
    // 局域网/容器网段不自动放行（只有组网接口才算"可信来源"）
    for (const cidr of plan.allowed.map((peer) => peer.cidr)) {
      expect(cidr).not.toBe('192.168.2.0/24');
      expect(cidr).not.toBe('172.17.0.0/16');
    }
    expect(plan.warnings).toEqual([]);
    expect(preferredRemoteAddress(plan.addresses)).toBe('10.239.5.174');
  });

  it('匹配：回环 + ZeroTier /24 + tailscale /10 放行；同 /16 别的 /24、局域网、公网拒绝', () => {
    const plan = allowedFor(realWorldInterfaces());
    const allowed = plan.allowed;
    // 放行
    for (const address of [
      '127.0.0.1',
      '127.0.0.53',
      '::1',
      '::ffff:127.0.0.1',
      '10.239.5.174',
      '10.239.5.1',
      '10.239.5.255',
      '100.125.4.119',
      '100.64.0.1',
      '100.127.255.255',
    ]) {
      expect(isPeerAllowed(address, allowed), `${address} 应该放行`).toBe(true);
    }
    // 拒绝：tailnet /10 之外的 100.x
    for (const address of [
      '10.239.6.9', // 同 /16 的另一个 /24 → ZeroTier 网络之外
      '10.239.4.9',
      '10.240.5.1',
      '192.168.2.10',
      '172.17.0.1',
      '8.8.8.8',
      '100.63.255.255',
      '100.128.0.1',
      'fd7a:115c:a1e0::12e:478', // tailscale 网卡上的 ULA IPv6：不自动放行（见文件头）
      'fe80::1%ztu7tmyt7w',
      '::ffff:192.168.2.10',
      '',
      'not-an-ip',
      undefined,
    ]) {
      expect(isPeerAllowed(address, allowed), `${String(address)} 应该拒绝`).toBe(false);
    }
  });

  it('tailscale：不管网卡掩码是 /32，一律放行整个 100.64.0.0/10', () => {
    const plan = allowedFor({ tailscale0: [ipv4('100.125.4.119', '255.255.255.255')] });
    expect(plan.virtual).toEqual([{ cidr: '100.64.0.0/10', family: 'IPv4', label: 'tailscale0' }]);
    expect(isPeerAllowed('100.100.100.100', plan.allowed)).toBe(true);
    expect(isPeerAllowed('100.125.4.119', plan.allowed)).toBe(true);
  });

  it('Windows 网卡名（ZeroTier One [..] / Tailscale）也能认出', () => {
    const plan = allowedFor({
      'ZeroTier One [1a2b3c4d5e6f7890]': [ipv4('10.147.20.5')],
      Tailscale: [ipv4('100.90.1.2', '255.255.255.255')],
    });
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.147.20.0/24(ZeroTier One [1a2b3c4d5e6f7890]), 100.64.0.0/10(Tailscale)'
    );
    expect(isPeerAllowed('10.147.20.77', plan.allowed)).toBe(true);
  });

  it('一个组网接口都没有 → 只有回环 + 明确 warning（远端连不上要能一眼看出原因）', () => {
    const plan = allowedFor({ enp174s0f0: [ipv4('192.168.2.10')] });
    expect(plan.virtual).toEqual([]);
    expect(plan.allowed).toEqual([...XIANGWO_CDP_LOOPBACK_PEERS]);
    expect(plan.warnings.join(' ')).toContain('未探测到 ZeroTier/tailscale');
    expect(isPeerAllowed('192.168.2.10', plan.allowed)).toBe(false);
  });

  it('掩码不连续 → 不猜网段，记 warning', () => {
    const plan = allowedFor({ zt0: [ipv4('10.1.2.3', '255.0.255.0')] });
    expect(plan.virtual).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('不是连续掩码');
  });

  it('family 报成数字 4（老 Node/个别运行时）也要能认出组网接口', () => {
    const plan = allowedFor({ ztu7tmyt7w: [ipv4NumericFamily('10.239.5.174')] });
    expect(plan.virtual.map((peer) => peer.cidr)).toEqual(['10.239.5.0/24']);
    expect(isPeerAllowed('10.239.5.9', plan.allowed)).toBe(true);
  });
});

describe('[XG-CUSTOM] XIANGWO_CDP_ALLOW 覆盖自动探测', () => {
  it('设了就只用它（+ 本机回环），组网网段不再自动放行', () => {
    const plan = allowedFor(realWorldInterfaces(), ['10.239.5.0/24']);
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.239.5.0/24(XIANGWO_CDP_ALLOW)'
    );
    expect(isPeerAllowed('10.239.5.9', plan.allowed)).toBe(true);
    expect(isPeerAllowed('127.0.0.1', plan.allowed)).toBe(true);
    for (const address of ['100.125.4.119', '10.239.6.9', '192.168.2.10', '8.8.8.8']) {
      expect(isPeerAllowed(address, plan.allowed), `${address} 应该拒绝`).toBe(false);
    }
  });

  it('非法项被忽略并 warning，合法项仍然生效', () => {
    const plan = allowedFor(realWorldInterfaces(), ['10.239.6.0/99', 'nope', '10.239.5.0/24']);
    expect(plan.virtual.map((peer) => peer.cidr)).toEqual(['10.239.5.0/24']);
    expect(plan.warnings.join(' ')).toContain('10.239.6.0/99');
    expect(plan.warnings.join(' ')).toContain('nope');
    expect(isPeerAllowed('10.239.5.9', plan.allowed)).toBe(true);
  });

  it('全部非法 → 回退自动探测（别把用户锁在门外）', () => {
    const plan = allowedFor(realWorldInterfaces(), ['nope', '10.0.0.0/33']);
    expect(plan.warnings.join(' ')).toContain('回退到自动探测');
    expect(plan.virtual.map((peer) => peer.cidr)).toEqual(['10.239.5.0/24', '100.64.0.0/10']);
  });

  it('显式写 /32 只放行那一台（临时收紧用）', () => {
    const plan = allowedFor(realWorldInterfaces(), ['10.239.5.174']);
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.239.5.174/32(XIANGWO_CDP_ALLOW)'
    );
    expect(isPeerAllowed('10.239.5.174', plan.allowed)).toBe(true);
    expect(isPeerAllowed('10.239.5.175', plan.allowed)).toBe(false);
  });
});

describe('[XG-CUSTOM] 小工具', () => {
  it('isTailscaleAddress 只认 100.64.0.0/10', () => {
    expect(isTailscaleAddress('100.64.0.0')).toBe(true);
    expect(isTailscaleAddress('100.127.255.255')).toBe(true);
    expect(isTailscaleAddress('100.63.255.255')).toBe(false);
    expect(isTailscaleAddress('100.128.0.0')).toBe(false);
    expect(isTailscaleAddress('10.239.5.174')).toBe(false);
  });

  it('isVirtualNetworkInterface 认 Linux/Windows 的 ZeroTier、tailscale 网卡名', () => {
    for (const name of ['ztu7tmyt7w', 'zt0', 'ZeroTier One [abc]', 'tailscale0', 'Tailscale']) {
      expect(isVirtualNetworkInterface(name), name).toBe(true);
    }
    for (const name of ['enp174s0f0', 'docker0', 'br-abc', 'lo', 'Wi-Fi']) {
      expect(isVirtualNetworkInterface(name), name).toBe(false);
    }
  });

  it('名字匹配大小写不敏感，并覆盖常见变体（ZEROTIER / zero tier / ZTN / tail scale）', () => {
    for (const name of [
      'ZeroTier One [8d1c312afafd650c]',
      'ZEROTIER ONE [8D1C312AFAFD650C]',
      'Zero Tier One',
      'ZTN123',
      'ZT1',
      'ztu7tmyt7w',
      'Tailscale',
      'TAILSCALE',
      'Tail Scale',
      'tailscale0',
    ]) {
      expect(isVirtualNetworkInterface(name), name).toBe(true);
    }
    expect(virtualInterfaceKind('ZeroTier One [abc]')).toBe('zerotier');
    expect(virtualInterfaceKind('Tailscale')).toBe('tailscale');
    expect(virtualInterfaceKind('以太网 3')).toBeNull();
    expect(virtualInterfaceKind('Ethernet')).toBeNull();
  });

  it('detectDefaultRouteAddress 结果与裸 dgram 一致（防"静默永远返回 null"）', async () => {
    // 先用裸 dgram 独立测一遍本机，两者必须一致 —— 曾经的 bug 就是 createSocket()
    // 忘了传 'udp4' 于是永远返回 null，而"允许 null"的断言根本发现不了。
    const expected = await new Promise<string | null>((resolve) => {
      const socket = createUdpSocket('udp4');
      let settled = false;
      const done = (value: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // 忽略
        }
        resolve(value);
      };
      const timer = setTimeout(() => done(null), 1000);
      socket.once('error', () => done(null));
      socket.connect(53, '8.8.8.8', () => done(socket.address().address));
    });
    expect(await detectDefaultRouteAddress(1000)).toBe(expected);
    if (expected !== null) expect(expected).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });

  it('Windows 防火墙提示只在 win32 打', () => {
    expect(windowsFirewallHint('win32')).toContain('防火墙');
    expect(windowsFirewallHint('win32')).toContain('允许');
    expect(windowsFirewallHint('linux')).toBeNull();
    expect(windowsFirewallHint('darwin')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [XG-CUSTOM] Windows 真机名形态（2026-09-30 反馈「ZeroTier 来源被拒」的回归）
// ─────────────────────────────────────────────────────────────────────────────

describe('[XG-CUSTOM] Windows 名形态（真机反馈回归）', () => {
  it('ZeroTier One [8d1c312afafd650c] = 10.239.5.218/24 → 10.239.5.x 放行、10.239.6.x 拒绝', () => {
    const plan = allowedFor({ 'ZeroTier One [8d1c312afafd650c]': [ipv4('10.239.5.218')] });
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.239.5.0/24(ZeroTier One [8d1c312afafd650c])'
    );
    expect(isPeerAllowed('10.239.5.174', plan.allowed)).toBe(true);
    expect(isPeerAllowed('10.239.5.218', plan.allowed)).toBe(true);
    expect(isPeerAllowed('10.239.6.5', plan.allowed)).toBe(false);
    expect(isPeerAllowed('192.168.1.5', plan.allowed)).toBe(false);
    // 判定明细要写清"靠名字命中"，排障时一眼看出
    expect(plan.report[0]?.verdict).toContain('匹配:zerotier(名字)');
    expect(plan.report[0]?.cidr).toBe('10.239.5.0/24');
  });

  it('Tailscale = 100.87.205.39/32 → 按 100.64/10 放行整个 tailnet', () => {
    const plan = allowedFor({ Tailscale: [ipv4('100.87.205.39', '255.255.255.255')] });
    expect(plan.virtual).toEqual([{ cidr: '100.64.0.0/10', family: 'IPv4', label: 'Tailscale' }]);
    expect(isPeerAllowed('100.87.205.39', plan.allowed)).toBe(true);
    expect(isPeerAllowed('100.99.1.1', plan.allowed)).toBe(true);
    expect(isPeerAllowed('100.63.1.1', plan.allowed)).toBe(false);
    expect(plan.report[0]?.verdict).toContain('匹配:tailscale(地址 100.64/10)');
  });

  it('报告里有名字/地址/掩码/mac/internal（排障四要素），回环标"跳过"', () => {
    const plan = allowedFor({
      lo: [{ ...ipv4('127.0.0.1', '255.0.0.0'), internal: true }],
      'ZeroTier One [abc]': [{ ...ipv4('10.239.5.218'), mac: '02:11:22:33:44:55' }],
    });
    const loopback = plan.report.find((item) => item.interfaceName === 'lo');
    expect(loopback?.internal).toBe(true);
    expect(loopback?.verdict).toContain('跳过（回环/内部网卡）');
    const zerotier = plan.report.find((item) => item.interfaceName === 'ZeroTier One [abc]');
    expect(zerotier).toMatchObject({
      family: 'IPv4',
      address: '10.239.5.218',
      netmask: '255.255.255.0',
      mac: '02:11:22:33:44:55',
      internal: false,
    });
  });

  it('未匹配的私有网段进 candidates（日志据此给出可直接粘贴的 XIANGWO_CDP_ALLOW）', () => {
    const plan = allowedFor({ '以太网 3': [ipv4('10.239.5.218')] });
    expect(plan.candidates).toEqual([
      { interfaceName: '以太网 3', address: '10.239.5.218', cidr: '10.239.5.0/24' },
    ]);
    // 公网/回环/链路本地不进候选
    expect(allowedFor({ eth0: [ipv4('8.8.8.8')] }).candidates).toEqual([]);
    expect(allowedFor({ eth0: [ipv4('169.254.3.4')] }).candidates).toEqual([]);
  });
});

describe('[XG-CUSTOM] 地址兜底（名字全不命中时的最后一道，边界写死）', () => {
  const unnamed10 = (): XiangwoCdpNetworkInterfaces => ({ '以太网 3': [ipv4('10.239.5.218')] });

  it('默认路由网卡不在 10/8 → 放行 10/8 接口的网段，并记一条 note', () => {
    const plan = collectXiangwoCdpAllowedPeers({
      interfaces: unnamed10(),
      defaultRouteAddress: '192.168.1.5',
    });
    expect(formatAllowedPeers(plan.allowed)).toBe(
      '127.0.0.1/8, ::1, 10.239.5.0/24(以太网 3(地址兜底:10/8))'
    );
    expect(isPeerAllowed('10.239.5.174', plan.allowed)).toBe(true);
    expect(isPeerAllowed('192.168.1.5', plan.allowed)).toBe(false);
    expect(plan.notes.join(' ')).toContain('地址兜底');
  });

  it('默认路由网卡本身在 10/8 → 不兜底（无法区分 ZeroTier 与局域网，宁可让人设 XIANGWO_CDP_ALLOW）', () => {
    const plan = collectXiangwoCdpAllowedPeers({
      interfaces: unnamed10(),
      defaultRouteAddress: '10.1.2.3',
    });
    expect(plan.allowed).toEqual([...XIANGWO_CDP_LOOPBACK_PEERS]);
    expect(isPeerAllowed('10.239.5.174', plan.allowed)).toBe(false);
    expect(plan.warnings.join(' ')).toContain('未探测到 ZeroTier/tailscale');
  });

  it('默认路由查不到（离线）→ 不兜底', () => {
    const plan = collectXiangwoCdpAllowedPeers({
      interfaces: unnamed10(),
      defaultRouteAddress: null,
    });
    expect(plan.allowed).toEqual([...XIANGWO_CDP_LOOPBACK_PEERS]);
    expect(plan.notes).toEqual([]);
  });

  it('172.x / 192.168.x 的未匹配接口不兜底（不把办公网放进来）', () => {
    const plan = collectXiangwoCdpAllowedPeers({
      interfaces: { '以太网 2': [ipv4('192.168.50.10')], '以太网 4': [ipv4('172.20.5.6')] },
      defaultRouteAddress: '192.168.1.5',
    });
    expect(plan.allowed).toEqual([...XIANGWO_CDP_LOOPBACK_PEERS]);
  });

  it('名字已经命中 → 不启用兜底（不额外放宽）', () => {
    const plan = collectXiangwoCdpAllowedPeers({
      interfaces: { ztu7tmyt7w: [ipv4('10.239.5.174')], '以太网 3': [ipv4('10.99.0.5')] },
      defaultRouteAddress: '192.168.1.5',
    });
    expect(plan.virtual.map((peer) => peer.cidr)).toEqual(['10.239.5.0/24']);
    expect(plan.notes).toEqual([]);
  });
});
