import { describe, expect, it, vi } from 'vitest';
import {
  resolveXiangwoBrowserProxy,
  XIANGWO_BROWSER_PROXY_DEFAULT,
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
    expect(resolved).toEqual({ proxy: 'socks5://10.0.0.1:1080', source: 'env' });
  });

  it('环境变量 off/none/direct → 显式直连（不再套缺省）', () => {
    for (const value of ['off', 'NONE', 'direct', ' ']) {
      const resolved = resolveXiangwoBrowserProxy({
        env: envOf({ [XIANGWO_BROWSER_PROXY_ENV]: value }),
        platform: 'win32',
      });
      if (value.trim() === '') {
        // 空白 = 等于没设 → 走平台缺省
        expect(resolved).toEqual({ proxy: XIANGWO_BROWSER_PROXY_DEFAULT, source: 'default' });
      } else {
        expect(resolved).toEqual({ proxy: undefined, source: 'env' });
      }
    }
  });

  it('配置文件（userData/xiangwo-browser-proxy.json）无需环境变量', () => {
    const read = vi.fn((fileName: string) => {
      expect(fileName).toBe(XIANGWO_BROWSER_PROXY_FILE);
      return '{"proxy":"socks5://100.125.4.119:1080"}';
    });
    const resolved = resolveXiangwoBrowserProxy({ env: envOf({}), platform: 'win32', readConfigFile: read });
    expect(resolved).toEqual({ proxy: 'socks5://100.125.4.119:1080', source: 'file' });
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
    expect(missing).toEqual({ proxy: XIANGWO_BROWSER_PROXY_DEFAULT, source: 'default' });

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
    expect(resolved).toEqual({ proxy: undefined, source: 'file' });
  });

  it('非 Linux 客户端缺省 socks5://100.125.4.119:1080，Linux 本机不设缺省', () => {
    expect(
      resolveXiangwoBrowserProxy({ env: envOf({}), platform: 'win32', readConfigFile: () => undefined })
    ).toEqual({ proxy: XIANGWO_BROWSER_PROXY_DEFAULT, source: 'default' });
    expect(
      resolveXiangwoBrowserProxy({ env: envOf({}), platform: 'linux', readConfigFile: () => undefined })
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
