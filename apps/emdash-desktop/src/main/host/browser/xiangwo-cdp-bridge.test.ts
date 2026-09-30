// [XG-CUSTOM] 内嵌浏览器 CDP 桥单测。
//
// 覆盖点（都是"链路能不能被 agent 第②级用上"的关键）：
//   - /json、/json/list、/json/version 的形状（browser_use 走 /json/version）
//   - target type 洗白成 page（否则 browser-use 的 get_tabs() 看不到内嵌浏览器）
//   - 白名单隔离：非白名单 targetId 一律附加失败
//   - 页面命令经 webContents.debugger 转发 + 事件按各客户端合成 sessionId 下发
//   - 命令超时 → 人话错误（不 hang）
//   - 大消息（走 64 位长度 / 掩码帧）双向都通
//   - 后来才绑定的内嵌浏览器会被自动 attach 推给已连接的客户端
import { afterEach, describe, expect, it } from 'vitest';
import {
  embeddedTargetId,
  XiangwoCdpBridge,
  type EmbeddedBrowserTarget,
  type XiangwoCdpDebugger,
  type XiangwoCdpWebContents,
} from './xiangwo-cdp-bridge';

type FakeTarget = EmbeddedBrowserTarget & {
  fake: FakeWebContents;
};

type MessageListener = (
  event: unknown,
  method: string,
  params: unknown,
  sessionId?: string
) => void;

class FakeDebugger implements XiangwoCdpDebugger {
  attached = false;
  readonly sendCalls: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }> = [];
  private readonly messageListeners: MessageListener[] = [];
  private readonly detachListeners: Array<(event: unknown, reason: string) => void> = [];

  attach(): void {
    if (this.attached) throw new Error('Debugger is already attached');
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  isAttached(): boolean {
    return this.attached;
  }

  on(event: 'message', listener: MessageListener): void;
  on(event: 'detach', listener: (event: unknown, reason: string) => void): void;
  on(event: 'message' | 'detach', listener: never): void {
    if (event === 'message') this.messageListeners.push(listener as unknown as MessageListener);
    else this.detachListeners.push(listener as unknown as (e: unknown, r: string) => void);
  }

  async sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    this.sendCalls.push({ method, params, sessionId });
    if (method === '__hang') return new Promise(() => {});
    if (method === 'Target.getTargetInfo') {
      return { targetInfo: { targetId: 'REAL-CHROMIUM-ID', browserContextId: 'CTX-REAL' } };
    }
    if (method === 'Page.captureScreenshot') {
      return { data: 'A'.repeat(200_000) };
    }
    // 假实现返回的就是"CDP 原始结果"（与真 Chromium 一样）
    return { echoed: method, params: params ?? null, sessionId: sessionId ?? null };
  }

  emitPageEvent(method: string, params: unknown): void {
    for (const listener of this.messageListeners) listener({}, method, params, undefined);
  }

  emitChildEvent(method: string, params: unknown, sessionId: string): void {
    for (const listener of this.messageListeners) listener({}, method, params, sessionId);
  }
}

class FakeWebContents implements XiangwoCdpWebContents {
  id = 1;
  url = 'http://127.0.0.1:1933/studio/home';
  title = 'OpenViking Studio';
  destroyed = false;
  focused = 0;
  closed = 0;
  readonly debugger = new FakeDebugger();

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.title;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  focus(): void {
    this.focused += 1;
  }

  close(): void {
    this.closed += 1;
  }
}

function fakeTarget(browserId: string): FakeTarget {
  const fake = new FakeWebContents();
  fake.id = Math.floor(Math.random() * 100000);
  return { browserId, webContents: fake, fake };
}

/** 极简 CDP 客户端（用 Node 自带 WebSocket，独立于桥的实现） */
class CdpTestClient {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();
  private nextId = 1;
  readonly events: Array<Record<string, unknown>> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message['id'] === 'number') {
        const resolve = this.pending.get(message['id'] as number);
        if (resolve) {
          this.pending.delete(message['id'] as number);
          resolve(message);
        }
        return;
      }
      this.events.push(message);
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === 1) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId;
    this.nextId += 1;
    const payload: Record<string, unknown> = { id, method, params: params ?? {} };
    if (sessionId !== undefined) payload['sessionId'] = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  close(): void {
    this.socket.close();
  }

  async waitForEvent(method: string, timeoutMs = 2500): Promise<Record<string, unknown> | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find((event) => event['method'] === method);
      if (found) return found;
      if (Date.now() > deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

const running: XiangwoCdpBridge[] = [];

async function startBridge(
  listTargets: () => EmbeddedBrowserTarget[],
  commandTimeoutMs = 500
): Promise<{ bridge: XiangwoCdpBridge; base: string }> {
  const port = 19300 + Math.floor(Math.random() * 200);
  const bridge = new XiangwoCdpBridge({ listTargets, port, commandTimeoutMs });
  running.push(bridge);
  const started = await bridge.start();
  expect(started).toBe(true);
  return { bridge, base: `http://127.0.0.1:${port}` };
}

afterEach(() => {
  for (const bridge of running.splice(0)) bridge.stop();
});

describe('[XG-CUSTOM] XiangwoCdpBridge', () => {
  it('/json/version 与 /json/list 只暴露白名单内嵌浏览器', async () => {
    const target = fakeTarget('task-1');
    const { base } = await startBridge(() => [target]);

    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    expect(version['webSocketDebuggerUrl']).toContain('/devtools/browser/');

    const list = (await (await fetch(`${base}/json/list`)).json()) as Array<Record<string, string>>;
    expect(list).toHaveLength(1);
    expect(list[0]?.['id']).toBe(embeddedTargetId('task-1'));
    expect(list[0]?.['type']).toBe('page');
    expect(list[0]?.['url']).toBe('http://127.0.0.1:1933/studio/home');
    expect(list[0]?.['webSocketDebuggerUrl']).toContain(`/devtools/page/${embeddedTargetId('task-1')}`);
  });

  it('getTargets/attachToTarget 把 webview 报成 page，页面命令转发到 debugger', async () => {
    const target = fakeTarget('task-2');
    const { base } = await startBridge(() => [target]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();

    const targets = (await client.send('Target.getTargets')) as {
      result: { targetInfos: Array<Record<string, unknown>> };
    };
    expect(targets.result.targetInfos).toHaveLength(1);
    expect(targets.result.targetInfos[0]?.['type']).toBe('page');
    expect(targets.result.targetInfos[0]?.['title']).toBe('OpenViking Studio');

    const attached = (await client.send('Target.attachToTarget', {
      targetId: embeddedTargetId('task-2'),
      flatten: true,
    })) as { result: { sessionId: string } };
    const sessionId = attached.result.sessionId;
    expect(sessionId).toBeTruthy();
    const attachEvent = await client.waitForEvent('Target.attachedToTarget');
    expect(attachEvent).toBeDefined();
    expect(target.fake.debugger.isAttached()).toBe(true);

    const evaluated = (await client.send(
      'Runtime.evaluate',
      { expression: '1+1', returnByValue: true },
      sessionId
    )) as { result: { echoed: string } };
    expect(evaluated.result.echoed).toBe('Runtime.evaluate');
    expect(target.fake.debugger.sendCalls.at(-1)?.method).toBe('Runtime.evaluate');
    // 合成 sessionId 不下传给 Chromium（那是"页面自身"会话）
    expect(target.fake.debugger.sendCalls.at(-1)?.sessionId).toBeUndefined();
    client.close();
  });

  it('非白名单 targetId 附加失败（主窗口不可附加）', async () => {
    const target = fakeTarget('task-3');
    const { base } = await startBridge(() => [target]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();

    const denied = (await client.send('Target.attachToTarget', {
      targetId: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF',
      flatten: true,
    })) as { error?: { code: number; message: string } };
    expect(denied.error?.code).toBe(-32000);
    expect(denied.error?.message).toContain('只暴露已绑定 browserId');
    // 没白名单命中 → 不会去 attach 任何 debugger
    expect(target.fake.debugger.isAttached()).toBe(false);
    client.close();
  });

  it('页面自身事件按合成 sessionId 下发；子 session 事件原样下发', async () => {
    const target = fakeTarget('task-4');
    const { base } = await startBridge(() => [target]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    const attached = (await client.send('Target.attachToTarget', {
      targetId: embeddedTargetId('task-4'),
    })) as { result: { sessionId: string } };

    target.fake.debugger.emitPageEvent('Page.loadEventFired', { timestamp: 1 });
    target.fake.debugger.emitChildEvent('Runtime.consoleAPICalled', { type: 'log' }, 'CHILD-1');

    const pageEvent = await client.waitForEvent('Page.loadEventFired');
    expect(pageEvent?.['sessionId']).toBe(attached.result.sessionId);
    const childEvent = await client.waitForEvent('Runtime.consoleAPICalled');
    expect(childEvent?.['sessionId']).toBe('CHILD-1');
    client.close();
  });

  it('命令超时 → 人话错误，不 hang', async () => {
    const target = fakeTarget('task-5');
    const { base } = await startBridge(() => [target], 200);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    const attached = (await client.send('Target.attachToTarget', {
      targetId: embeddedTargetId('task-5'),
    })) as { result: { sessionId: string } };

    const startedAt = Date.now();
    const timeout = (await client.send('__hang', {}, attached.result.sessionId)) as {
      error?: { message: string };
    };
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(timeout.error?.message).toContain('超时');
    client.close();
  });

  it('大消息双向都通（走 16/64 位长度与掩码帧）', async () => {
    const target = fakeTarget('task-6');
    const { base } = await startBridge(() => [target]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    const attached = (await client.send('Target.attachToTarget', {
      targetId: embeddedTargetId('task-6'),
    })) as { result: { sessionId: string } };

    const big = (await client.send(
      'Page.captureScreenshot',
      { note: 'B'.repeat(120_000) },
      attached.result.sessionId
    )) as { result: { data: string } };
    expect(big.result.data.length).toBe(200_000);
    expect(target.fake.debugger.sendCalls.at(-1)?.params?.['note']).toHaveLength(120_000);
    client.close();
  });

  it('/devtools/page/<id> 直连（老脚本 Runtime.evaluate 路径）', async () => {
    const target = fakeTarget('task-7');
    const { base } = await startBridge(() => [target]);
    const client = new CdpTestClient(
      `ws://127.0.0.1:${new URL(base).port}/devtools/page/${embeddedTargetId('task-7')}`
    );
    await client.open();
    const evaluated = (await client.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })) as { result: { echoed: string } };
    expect(evaluated.result.echoed).toBe('Runtime.evaluate');
    client.close();
  });

  it('没有内嵌浏览器打开时不报错、可快速失败（缺 targetId 附加直接报错）', async () => {
    const { base } = await startBridge(() => []);
    const list = (await (await fetch(`${base}/json/list`)).json()) as unknown[];
    expect(list).toEqual([]);

    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    const targets = (await client.send('Target.getTargets')) as {
      result: { targetInfos: unknown[] };
    };
    expect(targets.result.targetInfos).toEqual([]);
    const denied = (await client.send('Target.attachToTarget', { targetId: 'ANY' })) as {
      error?: { message: string };
    };
    expect(denied.error?.message).toContain('No target with given id found');
    client.close();
  });

  it('后来才绑定的内嵌浏览器会自动 attach 推给已连接客户端', async () => {
    const bound: FakeTarget[] = [];
    const late = fakeTarget('task-late');
    const { base } = await startBridge(() => bound);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    await client.send('Target.getTargets');

    bound.push(late);
    const attachEvent = await client.waitForEvent('Target.attachedToTarget', 3000);
    expect(attachEvent).toBeDefined();
    const params = attachEvent?.['params'] as { targetInfo: Record<string, unknown> };
    expect(params.targetInfo['targetId']).toBe(embeddedTargetId('task-late'));
    expect(late.fake.debugger.isAttached()).toBe(true);
    client.close();
  });

  it('已销毁的内嵌浏览器不再出现在目标清单里（不产生幽灵标签页）', async () => {
    const target = fakeTarget('task-dead');
    const { base } = await startBridge(() => [target]);
    const before = (await (await fetch(`${base}/json/list`)).json()) as unknown[];
    expect(before).toHaveLength(1);
    target.fake.destroyed = true;
    const after = (await (await fetch(`${base}/json/list`)).json()) as unknown[];
    expect(after).toEqual([]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();
    const targets = (await client.send('Target.getTargets')) as {
      result: { targetInfos: unknown[] };
    };
    expect(targets.result.targetInfos).toEqual([]);
    client.close();
  });

  it('attach 时先做输入唤醒（屏幕外 mouse down），再交给客户端 —— 否则冷启动第一次 fill 会静默失败', async () => {
    const target = fakeTarget('task-warmup');
    const { base } = await startBridge(() => [target]);
    const version = (await (await fetch(`${base}/json/version`)).json()) as Record<string, string>;
    const client = new CdpTestClient(version['webSocketDebuggerUrl']!);
    await client.open();

    await client.send('Target.attachToTarget', { targetId: embeddedTargetId('task-warmup') });
    const methods = target.fake.debugger.sendCalls.map((call) => call.method);
    // 读 target 元信息（browserContextId）是异步的，可能排在最前；关键是唤醒两项都要有
    expect(methods).toContain('Emulation.setFocusEmulationEnabled');
    expect(methods).toContain('Input.dispatchMouseEvent');
    const press = target.fake.debugger.sendCalls.find(
      (call) => call.method === 'Input.dispatchMouseEvent'
    );
    expect(press?.params).toMatchObject({ type: 'mousePressed', x: -10, y: -10 });
    // 屏幕外、且 mouse down/up 成对（点不到任何元素，也不会凑成 click）
    const mouseCalls = target.fake.debugger.sendCalls.filter(
      (call) => call.method === 'Input.dispatchMouseEvent'
    );
    expect(mouseCalls.map((call) => call.params?.['type'])).toEqual([
      'mousePressed',
      'mouseReleased',
    ]);

    // 唤醒必须发生在客户端第一条页面命令之前
    const attached = (await client.send('Target.attachToTarget', {
      targetId: embeddedTargetId('task-warmup'),
    })) as { result: { sessionId: string } };
    await client.send('Runtime.evaluate', { expression: '1' }, attached.result.sessionId);
    const evaluateIndex = target.fake.debugger.sendCalls.findIndex(
      (call) => call.method === 'Runtime.evaluate'
    );
    const lastWakeIndex = target.fake.debugger.sendCalls.reduce(
      (last, call, index) => (call.method === 'Input.dispatchMouseEvent' ? index : last),
      -1
    );
    expect(evaluateIndex).toBeGreaterThan(lastWakeIndex);
    client.close();
  });

  it('端口被占用时不抛异常（只返回 false）', async () => {
    const port = 19777;
    const first = new XiangwoCdpBridge({ listTargets: () => [], port });
    expect(await first.start()).toBe(true);
    const second = new XiangwoCdpBridge({ listTargets: () => [], port });
    expect(await second.start()).toBe(false);
    first.stop();
    second.stop();
  });
});
