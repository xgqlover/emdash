// [XG-CUSTOM] CDP 桥「来源白名单」单测：CIDR 匹配 + 组网网段自动探测 + XIANGWO_CDP_ALLOW 覆盖。
//
// 为什么这组测试重要：桥现在缺省听 0.0.0.0（装完即用），唯一的收口就是这里的白名单。
// 探测错 = 远端连不上（用户场景：ZeroTier 的 10.239.5.0/24）；放太宽 = 别人能操作内嵌浏览器。
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  collectXiangwoCdpAllowedPeers,
  formatAllowedPeers,
  isPeerAllowed,
  isTailscaleAddress,
  isVirtualNetworkInterface,
  parseXiangwoCdpAllowList,
  preferredRemoteAddress,
  resolveXiangwoCdpBindMode,
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

  it('Windows 防火墙提示只在 win32 打', () => {
    expect(windowsFirewallHint('win32')).toContain('防火墙');
    expect(windowsFirewallHint('win32')).toContain('允许');
    expect(windowsFirewallHint('linux')).toBeNull();
    expect(windowsFirewallHint('darwin')).toBeNull();
  });
});
