import { describe, expect, it, vi } from 'vitest';
import {
  abortableSleep,
  createXiangwoSseDecoder,
  failureText,
  interruptedNoteText,
  normalizeChatEndpoint,
  replyTextOf,
  resolveXiangwoChatUrl,
  retryStatusText,
  sendXiangwoChat,
  streamFailureText,
  streamXiangwoChat,
  waitingStatusText,
  wholeAnswerText,
  XiangwoNonRetryableError,
  XiangwoStreamFailure,
  XIANGWO_FALLBACK_CHAT_URL,
  XIANGWO_FIRST_BYTE_TIMEOUT_MS,
  XIANGWO_RETRY_DELAYS_MS,
  XIANGWO_STREAM_IDLE_TICK_MS,
  XIANGWO_STREAM_IDLE_TIMEOUT_MS,
  XIANGWO_STREAM_RETRY_DELAYS_MS,
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

/* ------------------------------------------------------------------------------------------------
 * [XG-CUSTOM 2026-10-05] SSE 流式：解码 / 耐心 / 降级
 * ---------------------------------------------------------------------------------------------- */

const encoder = new TextEncoder();

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error('waitUntil 超时');
    await sleep(5);
  }
}

/** 可手动推块的假 SSE 响应（body.getReader() 只有真 fetch 才有，所以这里手搓一个） */
function fakeStreamResponse(contentType = 'text/event-stream; charset=utf-8') {
  const queue: Uint8Array[] = [];
  let ended = false;
  let failure: Error | null = null;
  let closed = false;
  let notify: (() => void) | null = null;
  const wake = () => {
    const fn = notify;
    notify = null;
    fn?.();
  };
  const state = {
    cancelled: false,
    aborted: false,
  };
  const reader = {
    read: async () => {
      for (;;) {
        if (state.aborted) {
          throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        }
        const value = queue.shift();
        if (value !== undefined) return { value, done: false };
        if (failure !== null) throw failure;
        if (ended || closed) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    },
    cancel: async () => {
      state.cancelled = true;
      closed = true;
      wake();
    },
  };
  // 模拟 fetch 在 signal abort 时让读取失败（真 fetch 就是这个行为）
  const arm = (signal?: AbortSignal | null) => {
    if (signal === undefined || signal === null) return;
    const onAbort = () => {
      state.aborted = true;
      wake();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  };
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    body: { getReader: () => reader },
    __stream: { arm },
  } as unknown as Response;
  return {
    response,
    state,
    arm,
    push: (text: string) => {
      queue.push(encoder.encode(text));
      wake();
    },
    pushRaw: (bytes: Uint8Array) => {
      queue.push(bytes);
      wake();
    },
    end: () => {
      ended = true;
      wake();
    },
    fail: (error: Error) => {
      failure = error;
      wake();
    },
  };
}

function plainResponse(status: number, body: string, contentType = 'application/json') {
  const stream = fakeStreamResponse(contentType);
  stream.push(body);
  stream.end();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    body: stream.response.body,
    text: async () => body,
    __stream: { arm: stream.arm },
  } as unknown as Response;
}

/** 一个只记录请求、返回预置响应的 fetch 假实现（问它要几次给几次） */
function fakeFetch(responses: (() => Response)[]): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const factory = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (factory === undefined) throw new Error('fetch 被多调了一次');
    const response = factory();
    const stream = (response as unknown as { __stream?: { arm: (s?: AbortSignal | null) => void } })
      .__stream;
    stream?.arm(init?.signal);
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('[XG-CUSTOM] createXiangwoSseDecoder 增量解码', () => {
  it('跨 chunk 切断的一行/一帧也能拼回来，[DONE] 结束', () => {
    const decoder = createXiangwoSseDecoder();
    const frames = [
      ...decoder.push('data: {"choices":[{"delta":{"content":"你'),
      ...decoder.push('好"}}]}\n\ndata: {"choices":[{"delta":{"con'),
      ...decoder.push('tent":"世界"}}]}\n\n'),
      ...decoder.push('data: [DONE]\n\n'),
    ];
    expect(frames.map((frame) => frame.text)).toEqual(['你好', '世界']);
    expect(decoder.done()).toBe(true);
  });

  it('坏 JSON / 注释心跳 / 其它字段 / 半截帧 → 不崩、不产内容', () => {
    const decoder = createXiangwoSseDecoder();
    expect(decoder.push(': keep-alive\n\n')).toEqual([]);
    expect(decoder.push('event: ping\nid: 7\ndata: 这不是JSON\n\n')).toEqual([]);
    expect(decoder.push('data: {"choices":[{"delta":{"content":"半截')).toEqual([]);
    expect(decoder.done()).toBe(false);
  });

  it('delta.status → 状态帧；空 content → 心跳帧', () => {
    const decoder = createXiangwoSseDecoder();
    expect(decoder.push('data: {"choices":[{"delta":{"status":"agent 正在操作浏览器…"}}]}\n\n')).toEqual(
      [{ text: '', status: 'agent 正在操作浏览器…', heartbeat: false }]
    );
    expect(decoder.push('data: {"choices":[{"delta":{"content":""}}]}\n\n')).toEqual([
      { text: '', status: '', heartbeat: true },
    ]);
    expect(decoder.push('data: {"error":"模型忙"}\n\n')).toEqual([
      { text: '', status: '模型忙', heartbeat: false },
    ]);
  });

  it('服务端漏发收尾空行 → finish() 仍然把最后一段吐出来', () => {
    const decoder = createXiangwoSseDecoder();
    expect(decoder.push('data: {"choices":[{"delta":{"content":"尾巴"}}]}')).toEqual([]);
    expect(decoder.finish().map((frame) => frame.text)).toEqual(['尾巴']);
  });
});

describe('[XG-CUSTOM] streamXiangwoChat 流式接收', () => {
  it('分 5 个 chunk 推 delta.content → 边收边渲染、逐步增长、[DONE] 后结束', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl, calls } = fakeFetch([() => stream.response]);
    const seen: string[] = [];
    const parts: string[] = [];
    const pending = streamXiangwoChat({
      url: 'http://127.0.0.1:8900/v1/chat/completions',
      body: { stream: true },
      fetchImpl,
      idleTickMs: 10,
      onDelta: (delta) => {
        parts.push(delta);
        seen.push(parts.join(''));
      },
    });
    for (const piece of ['项', '我', '球', '流', '式']) {
      stream.push(sseChunk(piece));
      await sleep(15);
    }
    // 断言"中途某一刻内容已非空、且确实在长"
    expect(seen).toEqual(['项', '项我', '项我球', '项我球流', '项我球流式']);
    stream.push('data: [DONE]\n\n');
    const result = await pending;
    expect(result.text).toBe('项我球流式');
    expect(result.completed).toBe(true);
    expect(result.interrupted).toBe(false);
    expect(result.received).toBe(true);
    expect(result.nonSse).toBe(false);
    // 请求体带 stream:true（球在 body 里加，见 orb.js），Accept 也要 SSE
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ stream: true });
    expect(calls[0]?.init?.headers).toMatchObject({ Accept: 'text/event-stream' });
  });

  it('delta.status / 空 content 心跳 → 状态区回调（正文不掺水）', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl } = fakeFetch([() => stream.response]);
    const statuses: string[] = [];
    let heartbeats = 0;
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      idleTickMs: 10,
      onStatus: (line) => statuses.push(line),
      onHeartbeat: () => {
        heartbeats += 1;
      },
    });
    stream.push('data: {"choices":[{"delta":{"content":""}}]}\n\n');
    stream.push('data: {"choices":[{"delta":{"status":"agent 正在操作浏览器…"}}]}\n\n');
    stream.push(sseChunk('好了'));
    stream.push('data: [DONE]\n\n');
    const result = await pending;
    expect(heartbeats).toBe(1);
    expect(statuses).toEqual(['agent 正在操作浏览器…']);
    expect(result.text).toBe('好了');
  });

  it('UTF-8 多字节被切断（一个字符分两个 chunk）也不乱码', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl } = fakeFetch([() => stream.response]);
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      idleTickMs: 10,
    });
    const bytes = encoder.encode(sseChunk('中文'));
    stream.pushRaw(bytes.slice(0, 30));
    stream.pushRaw(bytes.slice(30));
    stream.push('data: [DONE]\n\n');
    const result = await pending;
    expect(result.text).toBe('中文');
  });
});

describe('[XG-CUSTOM] streamXiangwoChat 耐心（首字节 / 流内空闲）', () => {
  it('默认耐心值就是定案值：首字节 20s / 流内空闲 90s / 心跳 5s / 重试 2 次(2s,5s)', () => {
    expect(XIANGWO_FIRST_BYTE_TIMEOUT_MS).toBe(20_000);
    expect(XIANGWO_STREAM_IDLE_TIMEOUT_MS).toBe(90_000);
    expect(XIANGWO_STREAM_IDLE_TICK_MS).toBe(5_000);
    expect(XIANGWO_STREAM_RETRY_DELAYS_MS).toEqual([2000, 5000]);
  });

  it('首字节一直不来 → 触发重试（间隔 2s/5s），第 2 次才连上就成功', async () => {
    const dead = fakeStreamResponse(); // 永不 push
    const alive = fakeStreamResponse();
    const { fetchImpl, calls } = fakeFetch([() => dead.response, () => alive.response]);
    const sleeps: number[] = [];
    const retries: { attempt: number; delayMs: number }[] = [];
    const seen: string[] = [];
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      firstByteTimeoutMs: 40,
      idleTickMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      retryDelaysMs: [2000, 5000],
      onRetry: (attempt, delayMs) => retries.push({ attempt, delayMs }),
      onDelta: (delta) => seen.push(delta),
    });
    // 第 2 次请求（重试）后：推内容 → 必须不是失败
    await waitUntil(() => calls.length >= 2);
    alive.push(sseChunk('重试后成功'));
    alive.push('data: [DONE]\n\n');
    const result = await pending;
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
    expect(retries).toEqual([{ attempt: 1, delayMs: 2000 }]);
    expect(seen).toEqual(['重试后成功']);
    expect(result.interrupted).toBe(false);
  });

  it('首字节一直不来 + 三次都失败 → 0 字节才算失败，文案是人话', async () => {
    const streams = [fakeStreamResponse(), fakeStreamResponse(), fakeStreamResponse()];
    const { fetchImpl, calls } = fakeFetch(streams.map((stream) => () => stream.response));
    const retries: number[] = [];
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      firstByteTimeoutMs: 30,
      idleTickMs: 10,
      sleep: async () => {},
      retryDelaysMs: [1, 2],
      onRetry: (attempt) => retries.push(attempt),
    });
    const cause = await pending.then(
      () => null,
      (error: unknown) => error
    );
    expect(cause).toBeInstanceOf(XiangwoStreamFailure);
    expect(calls).toHaveLength(3); // 1 次 + 2 次重试
    expect(retries).toEqual([1, 2]);
    const text = streamFailureText(cause);
    expect(text.startsWith('调用失败: ')).toBe(true);
    expect(text).toContain('连不上后端（8900）');
    expect(text).toContain('首字节 20 秒等不到');
    expect(text).toContain('重试 2 次也没连上');
    expect(text).not.toContain('Failed to fetch');
  });

  it('收到过字节后长空闲（空闲阈值内）→ 不判失败、提示"已等待 N 秒"', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl } = fakeFetch([() => stream.response]);
    const idles: number[] = [];
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      firstByteTimeoutMs: 200,
      idleTimeoutMs: 30_000, // 流内空闲 30 秒
      idleTickMs: 40,
      onIdle: (idleMs) => idles.push(idleMs),
    });
    stream.push(sseChunk('开始答'));
    await sleep(150); // 相当于"70 秒长空闲"：只要没到 30 秒阈值就不判失败
    expect(idles.length).toBeGreaterThan(0);
    expect(waitingStatusText(idles[idles.length - 1] ?? 0)).toMatch(/^agent 还在干活…（已等待 \d+ 秒）$/);
    stream.push(sseChunk('，答完了'));
    stream.push('data: [DONE]\n\n');
    const result = await pending;
    expect(result.text).toBe('开始答，答完了');
    expect(result.interrupted).toBe(false);
    expect(result.completed).toBe(true);
  });

  it('收到过字节后空闲超过阈值 → 保留部分内容 + 标注（不是 Failed to fetch）', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl } = fakeFetch([() => stream.response]);
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      idleTimeoutMs: 60,
      idleTickMs: 20,
      // 流内断流绝不重试：fetch 只给一次
    });
    stream.push(sseChunk('已经收到的部分'));
    const result = await pending;
    expect(result.received).toBe(true);
    expect(result.interrupted).toBe(true);
    expect(result.interruptedReason).toBe('idle');
    expect(result.text).toBe('已经收到的部分');
    const note = interruptedNoteText(result.idleMs, 'idle');
    expect(note).toContain('（连接中断，已显示部分内容）');
    expect(note).toContain('可以继续等或点停止');
  });

  it('断流标注文案（92 秒）就是用户能看到的那句', () => {
    const note = interruptedNoteText(92_000, 'idle');
    expect(note).toContain('agent 还在干活（已等待 92 秒）');
    expect(note).toContain('可以继续等或点停止');
    expect(interruptedNoteText(0, 'network')).toContain('网络或服务重启了');
  });
});

describe('[XG-CUSTOM] streamXiangwoChat 降级', () => {
  it('服务端对 stream:true 回普通 JSON → 整段渲染，不是错误', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: '整段回答' } }] });
    const { fetchImpl } = fakeFetch([() => plainResponse(200, body, 'application/json')]);
    const deltas: string[] = [];
    const result = await streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: { stream: true },
      fetchImpl,
      idleTickMs: 10,
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result.nonSse).toBe(true);
    expect(result.received).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.interrupted).toBe(false);
    expect(result.text).toBe('整段回答');
    expect(deltas).toEqual(['整段回答']);
  });

  it('content-type 被标坏但正文是 SSE → 还是按 SSE 解（不泄漏 data: 原文）', async () => {
    const raw = `${sseChunk('甲')}${sseChunk('乙')}data: [DONE]\n\n`;
    const { fetchImpl } = fakeFetch([() => plainResponse(200, raw, 'application/octet-stream')]);
    const result = await streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      idleTickMs: 10,
    });
    expect(result.text).toBe('甲乙');
    expect(result.text).not.toContain('data:');
  });

  it('纯文本（非 JSON）响应 → 原样整段渲染', async () => {
    const { fetchImpl } = fakeFetch([() => plainResponse(200, '我是纯文本回答', 'text/plain')]);
    const result = await streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      idleTickMs: 10,
    });
    expect(result.text).toBe('我是纯文本回答');
    expect(result.nonSse).toBe(true);
  });

  it('流中途断（网络）→ 保留已收部分内容 + interrupted=network', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl, calls } = fakeFetch([() => stream.response]);
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      firstByteTimeoutMs: 200,
      idleTimeoutMs: 5000,
      idleTickMs: 20,
    });
    stream.push(sseChunk('前半段'));
    await waitUntil(() => true, 20);
    stream.fail(new Error('socket hang up'));
    const result = await pending;
    expect(result.text).toBe('前半段');
    expect(result.interrupted).toBe(true);
    expect(result.interruptedReason).toBe('network');
    // 断流后**不整轮重发**（否则会重复开网页/重复点按钮）
    expect(calls).toHaveLength(1);
  });

  it('4xx → 不重试、抛 XiangwoNonRetryableError', async () => {
    const { fetchImpl, calls } = fakeFetch([() => plainResponse(404, '{}', 'application/json')]);
    const cause = await streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      fetchImpl,
      sleep: async () => {},
    }).then(
      () => null,
      (error: unknown) => error
    );
    expect(cause).toBeInstanceOf(XiangwoNonRetryableError);
    expect(calls).toHaveLength(1);
    expect(streamFailureText(cause)).toBe(
      '调用失败: HTTP 404（后端不接受这个请求，重试也没用）'
    );
  });

  it('用户中止 → 保留已收内容、不抛错、不重试', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl, calls } = fakeFetch([() => stream.response]);
    const controller = new AbortController();
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      signal: controller.signal,
      fetchImpl,
      firstByteTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      idleTickMs: 20,
    });
    stream.push(sseChunk('已经收到的内容'));
    await sleep(30);
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.text).toBe('已经收到的内容');
    expect(result.interrupted).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('还没收到任何内容就中止 → 不抛错、aborted=true、0 字节', async () => {
    const stream = fakeStreamResponse();
    const { fetchImpl } = fakeFetch([() => stream.response]);
    const controller = new AbortController();
    const pending = streamXiangwoChat({
      url: 'http://h/v1/chat/completions',
      body: {},
      signal: controller.signal,
      fetchImpl,
      firstByteTimeoutMs: 5000,
      idleTickMs: 20,
    });
    setTimeout(() => controller.abort(), 20);
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.text).toBe('');
    expect(result.received).toBe(false);
  });

  it('wholeAnswerText：JSON 取 content / 坏 JSON 当纯文本 / SSE 标错也解得开', () => {
    expect(wholeAnswerText('{"choices":[{"message":{"content":"甲"}}]}')).toBe('甲');
    expect(wholeAnswerText('{"error":"坏了"}')).toBe('坏了');
    expect(wholeAnswerText('就是文本')).toBe('就是文本');
    expect(wholeAnswerText(`${sseChunk('丙')}data: [DONE]`)).toBe('丙');
    expect(wholeAnswerText('')).toBe('');
  });
});
