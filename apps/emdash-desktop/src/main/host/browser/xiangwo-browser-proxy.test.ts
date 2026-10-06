import { describe, expect, it, vi } from 'vitest';
import {
  resolveXiangwoBrowserProxy,
  XIANGWO_BROWSER_PROXY_DEFAULT,
  applySystemFirstDefault,
  systemProxyIsConfigured,
  XIANGWO_BROWSER_PROXY_ENV,
  XIANGWO_BROWSER_PROXY_FILE,
} from './xiangwo-browser-proxy';

function envOf(values: Record<string, string>): (name: string) => string | undefined {
  return (name) => values[name];
}

describe('[XG-CUSTOM] resolveXiangwoBrowserProxy', () => {
  it('环境变量优先', () => {
    const resolved = resolveXiangwoBrowserProxy({
      env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: 'socks5://10.0.0.1:1080' }),
      platform: 'linux',
    });
    expect(resolved).toEqual({ proxy: 'socks5://10.0.0.1:1080', mode: 'proxy', source: 'env' });
  });

  it('环境变量 off/none/direct → 显式直连（不再套缺省）', () => {
    for (const value of ['off', 'NONE', 'direct', ' ']) {
      const resolved = resolveXiangwoBrowserProxy({
        env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: value }),
        platform: 'win32',
      });
      if (value.trim() === '') {
        // 空白 = 等于没设 → 走平台缺省
        expect(resolved).toEqual({
          proxy: XIANGWO_BROWSER_PROXY_DEFAULT,
          mode: 'proxy',
          source: 'default',
        });
      } else {
        expect(resolved).toEqual({ proxy: undefined, mode: 'direct', source: 'env' });
      }
    }
  });

  it('配置文件（userData/xiangwo-browser-proxy.json）无需环境变量', () => {
    const read = vi.fn((fileName: string) => {
      expect(fileName).toBe(XIANGWO_BROWSER_PROXY_FILE);
      return '{"proxy":"socks5://100.125.4.119:1080"}';
    });
    const resolved = resolveXiangwoBrowserProxy({
      env: envOf({}),
      platform: 'win32',
      readConfigFile: read,
    });
    expect(resolved).toEqual({
      proxy: 'socks5://100.125.4.119:1080',
      mode: 'proxy',
      source: 'file',
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('配置文件坏 JSON / 缺字段 → 不崩，继续按平台兜底', () => {
    const log = vi.fn();
    const broken = resolveXiangwoBrowserProxy({
      env: envOf({}),
      platform: 'linux',
      readConfigFile: () => '{not json',
      log,
    });
    expect(broken).toBeUndefined();
    expect(log).toHaveBeenCalled();

    const missing = resolveXiangwoBrowserProxy({
      env: envOf({}),
      platform: 'win32',
      readConfigFile: () => undefined,
    });
    expect(missing).toEqual({
      proxy: XIANGWO_BROWSER_PROXY_DEFAULT,
      mode: 'proxy',
      source: 'default',
    });

    const noField = resolveXiangwoBrowserProxy({
      env: envOf({}),
      platform: 'linux',
      readConfigFile: () => '{}',
    });
    expect(noField).toBeUndefined();
  });

  it('配置文件 off → 显式直连（不套缺省）', () => {
    const resolved = resolveXiangwoBrowserProxy({
      env: envOf({}),
      platform: 'win32',
      readConfigFile: () => 'off',
    });
    expect(resolved).toEqual({ proxy: undefined, mode: 'direct', source: 'file' });
  });

  it('非 Linux 客户端缺省 socks5://10.239.5.174:1080（ZeroTier），Linux 本机不设缺省', () => {
    // [XG-CUSTOM] 2026-10-06 —— 把「缺省是哪个地址」钉死在测试里：
    // 原来写的是 Tailscale `100.125.4.119`，Windows 实测 0/12 全超时（`ERR_SOCKS_CONNECTION_FAILED`），
    // ZeroTier `10.239.5.174` 才是 12/12 能通的那条。写死常量值 → 谁改回去这条就红。
    expect(XIANGWO_BROWSER_PROXY_DEFAULT).toBe('socks5://10.239.5.174:1080');
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({}),
        platform: 'win32',
        readConfigFile: () => undefined,
      })
    ).toEqual({ proxy: XIANGWO_BROWSER_PROXY_DEFAULT, mode: 'proxy', source: 'default' });
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({}),
        platform: 'linux',
        readConfigFile: () => undefined,
      })
    ).toBeUndefined();
  });

  it('带空白的代理值被忽略（不抛给 Electron 解析）', () => {
    const resolved = resolveXiangwoBrowserProxy({
      env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: 'socks5://bad value' }),
      platform: 'linux',
    });
    expect(resolved).toBeUndefined();
  });
});

// ── [XG-CUSTOM] 2026-10-06 「跟随系统代理」（= 上游 emdash 原始行为）与「真直连」的区分 ──
describe('system / direct 两种显式语义', () => {
  it('环境变量 = system → 跟随系统代理（mode:system，不给 proxyRules）', () => {
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: 'system' }),
        platform: 'win32',
      })
    ).toEqual({ proxy: undefined, mode: 'system', source: 'env' });
  });

  it('环境的 auto / default / os 同样算跟随系统', () => {
    for (const value of ['auto', 'default', 'os', 'SYS']) {
      expect(
        resolveXiangwoBrowserProxy({
          env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: value }),
          platform: 'win32',
        })
      ).toEqual({ proxy: undefined, mode: 'system', source: 'env' });
    }
  });

  it('配置文件写 system → 也是跟随系统（优先级仍低于环境变量）', () => {
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({}),
        platform: 'win32',
        readConfigFile: () => '{"proxy":"system"}',
      })
    ).toEqual({ proxy: undefined, mode: 'system', source: 'file' });
  });

  it('off 是**真直连**（direct），不是跟随系统 —— 旧代码这里说一套做一套', () => {
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: 'off' }),
        platform: 'win32',
      })
    ).toEqual({ proxy: undefined, mode: 'direct', source: 'env' });
  });

  it('什么都不配 + 非 Linux → 仍是我们那条 socks5 缺省（本轮不改缺省，零回归）', () => {
    expect(
      resolveXiangwoBrowserProxy({
        env: envOf({}),
        platform: 'darwin',
        readConfigFile: () => undefined,
      })
    ).toEqual({ proxy: XIANGWO_BROWSER_PROXY_DEFAULT, mode: 'proxy', source: 'default' });
  });
});

// ── [XG-CUSTOM] 2026-10-06 「系统优先」（B 方案）：判系统有没有代理 + 决定最终走哪条 ──
describe('systemProxyIsConfigured / applySystemFirstDefault（系统优先）', () => {
  it('resolveProxy 结果解析：DIRECT 不算、任何非 DIRECT 段都算', () => {
    expect(systemProxyIsConfigured('DIRECT')).toBe(false);
    expect(systemProxyIsConfigured('')).toBe(false);
    expect(systemProxyIsConfigured(undefined)).toBe(false);
    expect(systemProxyIsConfigured('PROXY 127.0.0.1:7890')).toBe(true);
    expect(systemProxyIsConfigured('SOCKS5 127.0.0.1:1080')).toBe(true);
    expect(systemProxyIsConfigured('PROXY a:1; PROXY b:2')).toBe(true);
    expect(systemProxyIsConfigured('DIRECT; PROXY c:3')).toBe(true);
    expect(systemProxyIsConfigured('direct; ')).toBe(false);
  });

  it('系统有代理 + 什么都没配 → **跟随系统**（用户的梯子生效）', () => {
    const settings = {
      proxy: XIANGWO_BROWSER_PROXY_DEFAULT,
      mode: 'proxy' as const,
      source: 'default' as const,
    };
    expect(applySystemFirstDefault(settings, true)).toEqual({
      proxy: undefined,
      mode: 'system',
      source: 'default',
    });
  });

  it('系统没代理 + 什么都没配 → 保留内置 socks5 缺省（零回归）', () => {
    const settings = {
      proxy: XIANGWO_BROWSER_PROXY_DEFAULT,
      mode: 'proxy' as const,
      source: 'default' as const,
    };
    expect(applySystemFirstDefault(settings, false)).toEqual(settings);
  });

  it('**显式配的永远赢**：env / file 不受系统探测影响', () => {
    for (const source of ['env', 'file'] as const) {
      const settings = { proxy: 'socks5://1.2.3.4:1080', mode: 'proxy' as const, source };
      expect(applySystemFirstDefault(settings, true)).toEqual(settings);
      expect(applySystemFirstDefault(settings, false)).toEqual(settings);
    }
  });

  it('都没解析出来（undefined）→ 仍是 undefined', () => {
    expect(applySystemFirstDefault(undefined, true)).toBeUndefined();
  });
});
