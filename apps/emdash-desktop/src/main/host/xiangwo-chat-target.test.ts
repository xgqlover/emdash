import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatCompletionsEndpoint,
  computeXiangwoChatTarget,
  configureXiangwoChatTargetDeps,
  isLoopbackHost,
  isUsableHostAddress,
  resetXiangwoChatTargetCache,
  resolveXiangwoChatTarget,
  XIANGWO_LOCAL_CHAT_BASE,
  XIANGWO_UNREACHABLE_HINT,
} from './xiangwo-chat-target';

const LOCAL_ENDPOINT = `${XIANGWO_LOCAL_CHAT_BASE}/v1/chat/completions`;

beforeEach(() => {
  resetXiangwoChatTargetCache();
  delete process.env.XIANGWO_AGENT_URL;
});

describe('[XG-CUSTOM] chatCompletionsEndpoint', () => {
  it('归一化基址 / 半截地址 / 完整端点', () => {
    expect(chatCompletionsEndpoint('http://h:8900')).toBe('http://h:8900/v1/chat/completions');
    expect(chatCompletionsEndpoint('http://h:8900/')).toBe('http://h:8900/v1/chat/completions');
    expect(chatCompletionsEndpoint('http://h:8900/v1')).toBe('http://h:8900/v1/chat/completions');
    expect(chatCompletionsEndpoint('http://h:8900/v1/chat/completions')).toBe(
      'http://h:8900/v1/chat/completions'
    );
    expect(chatCompletionsEndpoint('')).toBe(LOCAL_ENDPOINT);
  });
});

describe('[XG-CUSTOM] isLoopbackHost', () => {
  it('识别 loopback 别名', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    expect(isLoopbackHost('10.239.5.174')).toBe(false);
    expect(isLoopbackHost('100.125.4.119')).toBe(false);
    // 空串 / 0.0.0.0 不是 loopback：它们是"没有可用地址"，走不可达分支
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });
});

describe('[XG-CUSTOM] isUsableHostAddress', () => {
  it('可拨号的主机名/IPv4/IPv6 才算可用', () => {
    expect(isUsableHostAddress('10.239.5.174')).toBe(true);
    expect(isUsableHostAddress('host.local')).toBe(true);
    expect(isUsableHostAddress('fe80::1')).toBe(true);
    expect(isUsableHostAddress('')).toBe(false);
    expect(isUsableHostAddress('   ')).toBe(false);
    expect(isUsableHostAddress('0.0.0.0')).toBe(false);
    expect(isUsableHostAddress('::')).toBe(false);
    expect(isUsableHostAddress('bad host')).toBe(false);
  });
});

describe('[XG-CUSTOM] computeXiangwoChatTarget', () => {
  it('没有远程主机 → 本机 127.0.0.1（保持旧行为）', async () => {
    const target = await computeXiangwoChatTarget({ activeRemoteHost: () => undefined });
    expect(target.url).toBe(LOCAL_ENDPOINT);
    expect(target.baseUrl).toBe(XIANGWO_LOCAL_CHAT_BASE);
    expect(target.source).toBe('local');
    expect(target.reachable).toBe(true);
    expect(target.hint).toBeUndefined();
  });

  it('主机就是 loopback → 本机', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: 'localhost' }),
    });
    expect(target.url).toBe(LOCAL_ENDPOINT);
    expect(target.source).toBe('local');
  });

  it('远程主机 + SSH 转发可用 → 用转发出来的本地地址', async () => {
    const forward = vi.fn(async () => 'http://127.0.0.1:49801');
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      forwardRemotePort: forward,
    });
    expect(forward).toHaveBeenCalledWith(8900);
    expect(target.url).toBe('http://127.0.0.1:49801/v1/chat/completions');
    expect(target.source).toBe('tunnel');
    expect(target.reachable).toBe(true);
  });

  it('远程主机 + 转发不可用 → 直连主机地址', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      forwardRemotePort: async () => null,
    });
    expect(target.url).toBe('http://10.239.5.174:8900/v1/chat/completions');
    expect(target.source).toBe('host');
    expect(target.reachable).toBe(true);
  });

  it('远程主机 + 转发抛异常 → 直连主机地址（不把球搞坏）', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '100.125.4.119' }),
      forwardRemotePort: async () => {
        throw new Error('no workspace server');
      },
    });
    expect(target.url).toBe('http://100.125.4.119:8900/v1/chat/completions');
    expect(target.source).toBe('host');
  });

  it('远程主机但拿不到地址 → 不可达信号 + 人话提示，URL 仍回落本机', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '   ' }),
      forwardRemotePort: async () => null,
    });
    expect(target.url).toBe(LOCAL_ENDPOINT);
    expect(target.source).toBe('fallback');
    expect(target.reachable).toBe(false);
    expect(target.hint).toBe(XIANGWO_UNREACHABLE_HINT);
  });

  it('环境变量覆盖（带 /v1 与完整端点两种写法）', async () => {
    const withV1 = await computeXiangwoChatTarget({
      env: () => 'http://10.239.5.174:8900/v1',
      activeRemoteHost: () => undefined,
    });
    expect(withV1.url).toBe('http://10.239.5.174:8900/v1/chat/completions');
    expect(withV1.source).toBe('env');

    const full = await computeXiangwoChatTarget({
      env: () => ' http://example.test:9000/v1/chat/completions ',
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
    });
    expect(full.url).toBe('http://example.test:9000/v1/chat/completions');
    expect(full.source).toBe('env');
  });

  it('读 process.env.XIANGWO_AGENT_URL（缺省来源）', async () => {
    process.env.XIANGWO_AGENT_URL = 'http://10.0.0.9:8900';
    const target = await computeXiangwoChatTarget({ activeRemoteHost: () => undefined });
    expect(target.url).toBe('http://10.0.0.9:8900/v1/chat/completions');
    expect(target.source).toBe('env');
  });

  it('解析异常 → 回落本机 127.0.0.1', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => {
        throw new Error('db 读不到');
      },
      forwardRemotePort: async () => 'http://127.0.0.1:1',
    });
    expect(target.url).toBe(LOCAL_ENDPOINT);
    expect(target.source).toBe('fallback');
    expect(target.reachable).toBe(true);
  });

  it('转发超时 → 直连主机地址（不卡第一条消息）', async () => {
    const target = await computeXiangwoChatTarget({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      forwardRemotePort: () => new Promise<string | null>(() => {}),
      tunnelTimeoutMs: 20,
    });
    expect(target.source).toBe('host');
  });
});

describe('[XG-CUSTOM] resolveXiangwoChatTarget 缓存', () => {
  it('TTL 内复用结果，reset 后重新解析', async () => {
    const activeRemoteHost = vi.fn(() => ({ connectionId: 'ssh-1', host: '10.239.5.174' }));
    configureXiangwoChatTargetDeps({
      activeRemoteHost,
      forwardRemotePort: async () => null,
      cacheTtlMs: 60_000,
    });    const first = await resolveXiangwoChatTarget();
    expect(first.source).toBe('host');
    expect(activeRemoteHost).toHaveBeenCalledTimes(1);
    const second = await resolveXiangwoChatTarget();
    expect(second).toEqual(first);
    expect(activeRemoteHost).toHaveBeenCalledTimes(1);
    resetXiangwoChatTargetCache();
    await resolveXiangwoChatTarget();
    expect(activeRemoteHost).toHaveBeenCalledTimes(2);
  });
});
