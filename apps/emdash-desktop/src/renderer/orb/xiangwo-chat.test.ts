import { describe, expect, it, vi } from 'vitest';
import {
  abortableSleep,
  failureText,
  normalizeChatEndpoint,
  replyTextOf,
  resolveXiangwoChatUrl,
  retryStatusText,
  sendXiangwoChat,
  XiangwoNonRetryableError,
  XIANGWO_FALLBACK_CHAT_URL,
  XIANGWO_RETRY_DELAYS_MS,
} from './xiangwo-chat';

type RecordedFetch = { url: string; body: unknown };

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe('[XG-CUSTOM] resolveXiangwoChatUrl', () => {
  it('用主进程解析出来的地址（preload）', async () => {
    const target = await resolveXiangwoChatUrl({
      resolveXiangwoChatUrl: async () => ({
        url: 'http://10.239.5.174:8900/v1/chat/completions',
        reachable: true,
        hint: '',
      }),
    });
    expect(target.url).toBe('http://10.239.5.174:8900/v1/chat/completions');
    expect(target.reachable).toBe(true);
  });

  it('基址也能归一化成端点', async () => {
    const target = await resolveXiangwoChatUrl({
      resolveXiangwoChatUrl: async () => ({ url: 'http://127.0.0.1:49801' }),
    });
    expect(target.url).toBe('http://127.0.0.1:49801/v1/chat/completions');
  });

  it('桥接缺失 / 抛错 / 返回值坏掉 → 回落 127.0.0.1', async () => {
    expect((await resolveXiangwoChatUrl(undefined)).url).toBe(XIANGWO_FALLBACK_CHAT_URL);
    expect(
      (
        await resolveXiangwoChatUrl({
          resolveXiangwoChatUrl: async () => {
            throw new Error('ipc down');
          },
        })
      ).url
    ).toBe(XIANGWO_FALLBACK_CHAT_URL);
    expect(
      (await resolveXiangwoChatUrl({ resolveXiangwoChatUrl: async () => ({ url: 'not-a-url' }) })).url
    ).toBe(XIANGWO_FALLBACK_CHAT_URL);
    expect((await resolveXiangwoChatUrl({ resolveXiangwoChatUrl: async () => null })).url).toBe(
      XIANGWO_FALLBACK_CHAT_URL
    );
  });

  it('不可达信号带着人话提示一起传下来', async () => {
    const target = await resolveXiangwoChatUrl({
      resolveXiangwoChatUrl: async () => ({
        url: XIANGWO_FALLBACK_CHAT_URL,
        reachable: false,
        hint: '当前是远程主机：8900 只在主机本机可达。',
      }),
    });
    expect(target.reachable).toBe(false);
    expect(target.hint).toContain('8900');
  });
});

describe('[XG-CUSTOM] normalizeChatEndpoint', () => {
  it('归一化各种写法', () => {
    expect(normalizeChatEndpoint('http://h:8900')).toBe('http://h:8900/v1/chat/completions');
    expect(normalizeChatEndpoint('http://h:8900/v1/')).toBe('http://h:8900/v1/chat/completions');
    expect(normalizeChatEndpoint('http://h:8900/v1/chat/completions')).toBe(
      'http://h:8900/v1/chat/completions'
    );
    expect(normalizeChatEndpoint('  ')).toBe(XIANGWO_FALLBACK_CHAT_URL);
  });
});

describe('[XG-CUSTOM] sendXiangwoChat 重试', () => {
  it('前两次网络失败、第三次成功 → 只发 3 次请求，间隔 1.5s/3s', async () => {
    const calls: RecordedFetch[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      if (calls.length <= 2) throw new TypeError('Failed to fetch');
      return jsonResponse(200, { choices: [{ message: { content: '好了' } }] });
    });
    const retries: { attempt: number; delayMs: number }[] = [];
    const sleeps: number[] = [];
    const data = await sendXiangwoChat({
      url: 'http://127.0.0.1:8900/v1/chat/completions',
      body: { messages: [] },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onRetry: (attempt, delayMs) => retries.push({ attempt, delayMs }),
    });
    expect(calls).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1500, 3000]);
    expect(retries).toEqual([
      { attempt: 1, delayMs: 1500 },
      { attempt: 2, delayMs: 3000 },
    ]);
    expect(replyTextOf(data)).toBe('好了');
  });

  it('5xx 也重试；三次重试全失败 → 抛最后一次错误', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
    await expect(
      sendXiangwoChat({
        url: 'http://h/v1/chat/completions',
        body: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
      })
    ).rejects.toThrow('HTTP 503');
    // 初次 + 3 次重试 = 4 次
    expect(fetchImpl).toHaveBeenCalledTimes(1 + XIANGWO_RETRY_DELAYS_MS.length);
  });

  it('4xx 不重试', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}));
    await expect(
      sendXiangwoChat({
        url: 'http://h/v1/chat/completions',
        body: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
      })
    ).rejects.toBeInstanceOf(XiangwoNonRetryableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('用户中止 → 不重试', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new TypeError('Failed to fetch');
    });
    await expect(
      sendXiangwoChat({
        url: 'http://h/v1/chat/completions',
        body: {},
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
      })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('重试等待期间用户中止 → 立刻停（不再发下一次请求）', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const sleep = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error('请求已停止'), { name: 'AbortError' });
    });
    await expect(
      sendXiangwoChat({
        url: 'http://h/v1/chat/completions',
        body: {},
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep,
      })
    ).rejects.toThrow('请求已停止');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('[XG-CUSTOM] abortableSleep 与文案', () => {
  it('已 abort 的 signal 直接拒绝', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1000, controller.signal)).rejects.toThrow('请求已停止');
  });

  it('等待中途 abort 立刻拒绝', async () => {
    const controller = new AbortController();
    const pending = abortableSleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('请求已停止');
  });

  it('重试/失败文案', () => {
    expect(retryStatusText(2)).toBe('后端启动中…（第 2 次重试）');
    expect(failureText(new Error('HTTP 500'))).toBe('调用失败: HTTP 500');
    expect(failureText('x')).toBe('调用失败: x');
  });
});
