// [XG-CUSTOM] 内嵌浏览器反向通道单测：只测"出站拨号 + 本地转发 + 结果回传"这套协议，
// 不碰 Electron（fetch / WebSocket 都注入假的），也不碰真 emdash。
import { describe, expect, it, vi } from 'vitest';
import {
  cdpCallOnce,
  isLocalAgentBase,
  localWsBaseOf,
  relayEnabledFromEnv,
  XiangwoBrowserRelay,
  type RelayWebSocket,
} from './xiangwo-browser-relay';

type Call = { url: string; init: RequestInit | undefined };

/** 假 fetch：按 URL 路由，记录所有调用。**先让出一个宏任务**，否则 relay 的
 * `while` 循环靠微任务就能一直转，setTimeout 永远排不上（单测会假死）。 */
function makeFetch(routes: (url: string, init: RequestInit | undefined) => Response | undefined) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
    const routed = routes(url, init);
    if (routed === undefined) throw new Error(`no route for ${url}`);
    return routed;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 假 WebSocket：手动触发 onopen / onmessage */
function makeFakeWs() {
  const sockets: Array<{
    url: string;
    sent: string[];
    ws: RelayWebSocket;
    open(): void;
    message(data: string): void;
    closed: boolean;
  }> = [];
  const factory = (url: string) => {
    const record = {
      url,
      sent: [] as string[],
      ws: undefined as unknown as RelayWebSocket,
      open: () => undefined,
      message: (_data: string) => undefined,
      closed: false,
    };
    const ws: RelayWebSocket = {
      send: (data: string) => {
        record.sent.push(data);
      },
      close: () => {
        record.closed = true;
        ws.onclose?.(undefined);
      },
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    record.ws = ws;
    record.open = () => {
      ws.onopen?.(undefined);
    };
    record.message = (data: string) => {
      ws.onmessage?.({ data });
    };
    sockets.push(record);
    return ws;
  };
  return { factory, sockets };
}

const POLL = 'http://linux:8900/api/emdash-browser/poll';

/** 让 relay 的循环跑几轮（poll 是 async，靠让出宏任务推进） */
async function tick(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
  }
}

describe('xiangwo-browser-relay 开关与小工具', () => {
  it('XIANGWO_BROWSER_RELAY=0/off 关闭，其它（含未设）开启', () => {
    expect(relayEnabledFromEnv(undefined)).toBe(true);
    expect(relayEnabledFromEnv('')).toBe(true);
    expect(relayEnabledFromEnv('1')).toBe(true);
    expect(relayEnabledFromEnv('0')).toBe(false);
    expect(relayEnabledFromEnv('OFF')).toBe(false);
    expect(relayEnabledFromEnv('false')).toBe(false);
  });

  it('localWsBaseOf 由 http 基址推导 ws 基址（端口缺省补 9223）', () => {
    expect(localWsBaseOf('http://127.0.0.1:9223')).toBe('ws://127.0.0.1:9223');
    expect(localWsBaseOf('http://127.0.0.1')).toBe('ws://127.0.0.1:9223');
    expect(localWsBaseOf('garbage')).toBe('ws://127.0.0.1:9223');
  });

  it('isLocalAgentBase 只认"回环 + 正好 8900"（SSH 转发端口不算）', () => {
    // 家里那台 Linux：agent 与本机 emdash 同机 → 本机 emdash 不该再拨回来
    expect(isLocalAgentBase('http://127.0.0.1:8900')).toBe(true);
    expect(isLocalAgentBase('http://localhost:8900')).toBe(true);
    expect(isLocalAgentBase('http://[::1]:8900/')).toBe(true);
    // Windows 各种情形：SSH 转发的回环端口 / 组网地址 → 都要拨
    expect(isLocalAgentBase('http://127.0.0.1:51234')).toBe(false);
    expect(isLocalAgentBase('http://10.239.5.174:8900')).toBe(false);
    expect(isLocalAgentBase('http://100.125.4.119:8900')).toBe(false);
    expect(isLocalAgentBase('http://127.0.0.1')).toBe(false);
    expect(isLocalAgentBase('garbage')).toBe(false);
  });
});

describe('xiangwo-browser-relay 命令往返', () => {
  it('http 命令：转发到本机 9223 并把响应体回传（/json/version）', async () => {
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        // 只在第一次给命令，之后一直挂 204
        return calls.filter((c) => c.url.startsWith(POLL)).length === 1
          ? json({ id: 7, kind: 'http', method: 'GET', path: '/json/version' })
          : new Response(null, { status: 204 });
      }
      if (url === 'http://127.0.0.1:9223/json/version') {
        return json({ Browser: 'emdash embedded-browser bridge' });
      }
      if (url.endsWith('/api/emdash-browser/result')) {
        return json({ ok: true });
      }
      return undefined;
    });

    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      log: () => undefined,
    });
    relay.start();
    await tick();
    relay.stop();

    const result = calls.find((c) => c.url.endsWith('/api/emdash-browser/result'));
    expect(result).toBeDefined();
    const body = JSON.parse(String(result?.init?.body)) as {
      id: number;
      ok: boolean;
      payload: { status: number; body: string };
    };
    expect(body.id).toBe(7);
    expect(body.ok).toBe(true);
    expect(body.payload.status).toBe(200);
    expect(body.payload.body).toContain('emdash embedded-browser bridge');
    // 关键：确实是从"出站长轮询"里拿的命令，本机 9223 只是被本地转发
    expect(calls.some((c) => c.url.startsWith(POLL))).toBe(true);
  });

  it('ws-open / ws-send：把本机 9223 的 CDP 帧回传成 event（串行 + 合批）', async () => {
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        const pollNo = calls.filter((c) => c.url.startsWith(POLL)).length;
        if (pollNo === 1)
          return json({ id: 1, kind: 'ws-open', sid: 's1', path: '/devtools/browser/XG' });
        if (pollNo === 2) return json({ id: 2, kind: 'ws-send', sid: 's1', data: '{"id":1}' });
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/api/emdash-browser/result')) return json({ ok: true });
      if (url.endsWith('/api/emdash-browser/event')) return json({ ok: true });
      return undefined;
    });
    const { factory, sockets } = makeFakeWs();

    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      webSocketFactory: factory,
      log: () => undefined,
    });
    relay.start();
    await tick(6);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:9223/devtools/browser/XG');
    sockets[0]?.open();
    await tick(6);

    // 本机 9223 → 对面：两帧应被合批进同一个 event POST，且顺序保持
    sockets[0]?.message('{"id":1,"result":{}}');
    sockets[0]?.message('{"method":"Page.loadEventFired"}');
    await tick(6);
    relay.stop();

    const events = calls.filter((c) => c.url.endsWith('/api/emdash-browser/event'));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = JSON.parse(String(events[0]?.init?.body)) as {
      kind: string;
      sid: string;
      frames: string[];
    };
    expect(first.kind).toBe('ws-msg');
    expect(first.sid).toBe('s1');
    expect(first.frames[0]).toContain('"id":1');
    // 对面发来的 CDP 命令确实写进了本机 9223 的 WS
    expect(sockets[0]?.sent).toContain('{"id":1}');
  });

  it('解析出的地址是"本机 8900"（agent 与本机 emdash 同机）→ 自我停用，不发请求', async () => {
    const { impl, calls } = makeFetch(() => json({}));
    const logs: string[] = [];
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://127.0.0.1:8900',
      fetchImpl: impl,
      backoffStepsMs: [1],
      log: (message) => logs.push(message),
    });
    relay.start();
    await tick(4);
    expect(calls).toHaveLength(0);
    expect(relay.status().enabled).toBe(false);
    expect(logs.join('\n')).toContain('agent 就在本机');
  });

  it('显式给了地址（skipLocalAgentBase=false）→ 就算指向 127.0.0.1:8900 也照拨（自测/强制场景）', async () => {
    const { impl, calls } = makeFetch((url) =>
      url.startsWith(POLL) ? new Response(null, { status: 204 }) : json({})
    );
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://127.0.0.1:8900',
      fetchImpl: impl,
      skipLocalAgentBase: false,
      log: () => undefined,
    });
    relay.start();
    await tick(4);
    relay.stop();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('对面没起来（poll 报错）→ 只记错误 + 退避，不抛异常', async () => {
    const { impl, calls } = makeFetch(() => new Response('boom', { status: 502 }));
    const logs: string[] = [];
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      backoffStepsMs: [5],
      log: (message) => logs.push(message),
    });
    relay.start();
    await tick(4);
    relay.stop();
    expect(calls.length).toBeGreaterThan(0);
    expect(relay.status().errors).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('502');
  });

  it('解析不出地址 → 记错误并退避，不发请求', async () => {
    const { impl, calls } = makeFetch(() => json({}));
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => null,
      fetchImpl: impl,
      backoffStepsMs: [5],
      log: () => undefined,
    });
    relay.start();
    await tick(4);
    relay.stop();
    expect(calls).toHaveLength(0);
    expect(relay.status().errors).toBeGreaterThan(0);
  });
});

describe('xiangwo-browser-relay open 命令（跨机"说打开就打开"）', () => {
  it('本机 9223 没有内嵌浏览器 → 回人话错误，不偷偷操作别的浏览器', async () => {
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        return calls.filter((c) => c.url.startsWith(POLL)).length === 1
          ? json({ id: 3, kind: 'open', url: 'https://example.com' })
          : new Response(null, { status: 204 });
      }
      if (url === 'http://127.0.0.1:9223/json/list') return json([]);
      if (url.endsWith('/api/emdash-browser/result')) return json({ ok: true });
      return undefined;
    });
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      log: () => undefined,
    });
    relay.start();
    await tick();
    relay.stop();
    const result = calls.find((c) => c.url.endsWith('/api/emdash-browser/result'));
    const body = JSON.parse(String(result?.init?.body)) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('没有打开的内嵌浏览器');
  });

  it('本机 9223 有内嵌页 → Page.navigate 过去并回读 location.href', async () => {
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        return calls.filter((c) => c.url.startsWith(POLL)).length === 1
          ? json({ id: 4, kind: 'open', url: 'https://example.com' })
          : new Response(null, { status: 204 });
      }
      if (url === 'http://127.0.0.1:9223/json/list') {
        return json([
          {
            id: 'XG-EMBEDDED',
            type: 'page',
            url: 'about:blank',
            title: '新标签页',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/XG-EMBEDDED',
          },
        ]);
      }
      if (url.endsWith('/api/emdash-browser/result')) return json({ ok: true });
      return undefined;
    });
    const { factory, sockets } = makeFakeWs();
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      webSocketFactory: factory,
      log: () => undefined,
    });
    relay.start();
    await tick(6);
    // open 开一条一次性 CDP 连接发 Page.navigate
    expect(sockets.length).toBeGreaterThanOrEqual(1);
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:9223/devtools/page/XG-EMBEDDED');
    sockets[0]?.open();
    sockets[0]?.message(JSON.stringify({ id: 1, result: { frameId: 'f1' } }));
    await tick(6);
    relay.stop();
    const sent = JSON.parse(String(sockets[0]?.sent[0])) as {
      method: string;
      params: { url: string };
    };
    expect(sent.method).toBe('Page.navigate');
    expect(sent.params.url).toBe('https://example.com');
    const result = calls.find((c) => c.url.endsWith('/api/emdash-browser/result'));
    const body = JSON.parse(String(result?.init?.body)) as {
      ok: boolean;
      payload: { target_id: string };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.target_id).toBe('XG-EMBEDDED');
  });

  // [XG-CUSTOM 2026-10] 「从零开页」：一个内嵌浏览器都没有时，先请渲染进程开一个再导航。
  // 抄的是 HippoBuddy「标记驱动自动开页」那一环，补掉「必须人工先开 Browser 标签页」的缺口。
  it('没有内嵌页 + 接了开页回调 → 先广播开页请求，等到页面被绑定后再 navigate', async () => {
    let listCalls = 0;
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        return calls.filter((c) => c.url.startsWith(POLL)).length === 1
          ? json({ id: 9, kind: 'open', url: 'https://example.com' })
          : new Response(null, { status: 204 });
      }
      if (url === 'http://127.0.0.1:9223/json/list') {
        listCalls += 1;
        // 第一轮（进 handleOpen 时）为空 → 触发自动开页；之后出现新页
        return listCalls === 1
          ? json([])
          : json([
              {
                id: 'XG-AUTO',
                type: 'page',
                url: 'about:blank',
                title: '新标签页',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/XG-AUTO',
              },
            ]);
      }
      if (url.endsWith('/api/emdash-browser/result')) return json({ ok: true });
      return undefined;
    });
    const { factory, sockets } = makeFakeWs();
    const opened: string[] = [];
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      webSocketFactory: factory,
      openBrowserWaitMs: 2000,
      requestOpenBrowser: (url) => opened.push(url),
      log: () => undefined,
    });
    relay.start();
    await tick(12);
    expect(opened).toEqual(['https://example.com']); // 广播过开页请求
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:9223/devtools/page/XG-AUTO');
    sockets[0]?.open();
    sockets[0]?.message(JSON.stringify({ id: 1, result: { frameId: 'f1' } }));
    await tick(6);
    relay.stop();
    const result = calls.find((c) => c.url.endsWith('/api/emdash-browser/result'));
    const body = JSON.parse(String(result?.init?.body)) as {
      ok: boolean;
      payload: { target_id: string };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.target_id).toBe('XG-AUTO');
  });

  it('接了开页回调但一直没页面出现 → ok:false 且错误里说清是"自动开也没等到"', async () => {
    const { impl, calls } = makeFetch((url) => {
      if (url.startsWith(POLL)) {
        return calls.filter((c) => c.url.startsWith(POLL)).length === 1
          ? json({ id: 11, kind: 'open', url: 'https://example.com' })
          : new Response(null, { status: 204 });
      }
      if (url === 'http://127.0.0.1:9223/json/list') return json([]);
      if (url.endsWith('/api/emdash-browser/result')) return json({ ok: true });
      return undefined;
    });
    const opened: string[] = [];
    const relay = new XiangwoBrowserRelay({
      resolveBaseUrl: async () => 'http://linux:8900',
      fetchImpl: impl,
      webSocketFactory: makeFakeWs().factory,
      openBrowserWaitMs: 60,
      requestOpenBrowser: (url) => opened.push(url),
      log: () => undefined,
    });
    relay.start();
    // 轮询间隔 150ms + waitMs 60ms → 至少要等过一拍（tick 每拍 ~2ms，给足余量）
    await tick(250);
    relay.stop();
    expect(opened).toEqual(['https://example.com']);
    const result = calls.find((c) => c.url.endsWith('/api/emdash-browser/result'));
    const body = JSON.parse(String(result?.init?.body)) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('没有打开的内嵌浏览器');
    expect(body.error).toContain('自动开一个但没等到');
  });
});

describe('cdpCallOnce', () => {
  it('一条命令一次调用；CDP 报错 → reject（不 hang）', async () => {
    const { factory, sockets } = makeFakeWs();
    const promise = cdpCallOnce(factory, 'ws://x/devtools/page/1', 'Page.navigate', { url: 'u' });
    sockets[0]?.open();
    expect(JSON.parse(String(sockets[0]?.sent[0]))).toEqual({
      id: 1,
      method: 'Page.navigate',
      params: { url: 'u' },
    });
    sockets[0]?.message(JSON.stringify({ id: 1, error: { message: 'nope' } }));
    await expect(promise).rejects.toThrow('nope');
  });

  it('连不上（构造即抛）→ reject', async () => {
    const factory = vi.fn(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(cdpCallOnce(factory, 'ws://x/y', 'Page.navigate')).rejects.toThrow('ECONNREFUSED');
  });
});
