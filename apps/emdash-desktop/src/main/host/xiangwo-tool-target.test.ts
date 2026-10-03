// [XG-CUSTOM] 2026-10-03 工具窗口地址解析（隧道 → 主机直连 → 本机）单测：
// 守护「外地客户端不再白屏」这条行为——隧道 null/抛错/超时都必须回落到主机地址。
import { describe, expect, it } from 'vitest';
import {
  computeToolWindowTarget,
  localToolUrl,
  normalizeToolPath,
  toolAuthority,
} from './xiangwo-tool-target';

const REMOTE = { connectionId: 'c1', host: '10.239.5.174' };

describe('[XG-CUSTOM] 2026-10-03 normalizeToolPath', () => {
  it('空 / 单斜杠 / 无斜杠 / 多尾斜杠都归一', () => {
    expect(normalizeToolPath(undefined)).toBe('');
    expect(normalizeToolPath('')).toBe('');
    expect(normalizeToolPath('/')).toBe('');
    expect(normalizeToolPath('studio')).toBe('/studio');
    expect(normalizeToolPath('/studio')).toBe('/studio');
    expect(normalizeToolPath('/studio/')).toBe('/studio');
    expect(normalizeToolPath('/a/b///')).toBe('/a/b');
  });
});

describe('[XG-CUSTOM] 2026-10-03 toolAuthority', () => {
  it('IPv4/主机名原样，IPv6 加方括号', () => {
    expect(toolAuthority('10.239.5.174')).toBe('10.239.5.174');
    expect(toolAuthority('host.local')).toBe('host.local');
    expect(toolAuthority('fe80::1')).toBe('[fe80::1]');
    expect(toolAuthority('[fe80::1]')).toBe('[fe80::1]');
  });
});

describe('[XG-CUSTOM] 2026-10-03 localToolUrl', () => {
  it('本机地址 = 旧行为', () => {
    expect(localToolUrl(3010)).toBe('http://127.0.0.1:3010');
    expect(localToolUrl(1933, '/studio')).toBe('http://127.0.0.1:1933/studio');
  });
});

describe('[XG-CUSTOM] 2026-10-03 computeToolWindowTarget', () => {
  it('没有远程主机 → 本机（客户端 == 主机，保持旧行为）', async () => {
    const t = await computeToolWindowTarget(3010, '/', {});
    expect(t).toEqual({ url: 'http://127.0.0.1:3010', source: 'local' });
  });

  it('主机就是 loopback → 本机', async () => {
    const t = await computeToolWindowTarget(3010, '/', {
      activeRemoteHost: () => ({ connectionId: 'c', host: '127.0.0.1' }),
    });
    expect(t.source).toBe('local');
    expect(t.url).toBe('http://127.0.0.1:3010');
  });

  it('隧道可用 → 用隧道地址（AFFiNE 无 path）', async () => {
    const t = await computeToolWindowTarget(3010, '/', {
      activeRemoteHost: () => REMOTE,
      forwardRemotePort: async () => 'http://127.0.0.1:41234',
    });
    expect(t).toEqual({ url: 'http://127.0.0.1:41234', source: 'tunnel' });
  });

  it('隧道可用 + path（OpenViking /studio）', async () => {
    const t = await computeToolWindowTarget(1933, '/studio', {
      activeRemoteHost: () => REMOTE,
      forwardRemotePort: async () => 'http://127.0.0.1:41235/',
    });
    expect(t).toEqual({ url: 'http://127.0.0.1:41235/studio', source: 'tunnel' });
  });

  it('★ 隧道返回 null → 直连主机（Windows 客户端不再白屏）', async () => {
    const t = await computeToolWindowTarget(3010, '/', {
      activeRemoteHost: () => REMOTE,
      forwardRemotePort: async () => null,
    });
    expect(t).toEqual({ url: 'http://10.239.5.174:3010', source: 'host' });
  });

  it('★ 隧道抛错 → 直连主机', async () => {
    const t = await computeToolWindowTarget(9037, '/', {
      activeRemoteHost: () => REMOTE,
      forwardRemotePort: async () => {
        throw new Error('SSH connection is not available');
      },
    });
    expect(t).toEqual({ url: 'http://10.239.5.174:9037', source: 'host' });
  });

  it('★ 隧道超时 → 直连主机（不卡窗口）', async () => {
    const t = await computeToolWindowTarget(5180, '/', {
      activeRemoteHost: () => REMOTE,
      forwardRemotePort: () => new Promise<string | null>(() => {}),
      tunnelTimeoutMs: 20,
    });
    expect(t).toEqual({ url: 'http://10.239.5.174:5180', source: 'host' });
  });

  it('主机地址不可用（0.0.0.0 / 空）→ 本机', async () => {
    for (const host of ['0.0.0.0', '', '::']) {
      const t = await computeToolWindowTarget(3010, '/', {
        activeRemoteHost: () => ({ connectionId: 'c', host }),
        forwardRemotePort: async () => null,
      });
      expect(t.source).toBe('local');
      expect(t.url).toBe('http://127.0.0.1:3010');
    }
  });

  it('IPv6 主机加方括号', async () => {
    const t = await computeToolWindowTarget(3010, '/', {
      activeRemoteHost: () => ({ connectionId: 'c', host: 'fe80::1' }),
      forwardRemotePort: async () => null,
    });
    expect(t.url).toBe('http://[fe80::1]:3010');
  });

  it('activeRemoteHost 抛错 → 本机，且不把异常抛出去', async () => {
    const t = await computeToolWindowTarget(3010, '/', {
      activeRemoteHost: () => {
        throw new Error('db is locked');
      },
    });
    expect(t).toEqual({ url: 'http://127.0.0.1:3010', source: 'local' });
  });

  it('没有注入 forwardRemotePort 也能直连主机', async () => {
    const t = await computeToolWindowTarget(18766, '/', { activeRemoteHost: () => REMOTE });
    expect(t).toEqual({ url: 'http://10.239.5.174:18766', source: 'host' });
  });
});
