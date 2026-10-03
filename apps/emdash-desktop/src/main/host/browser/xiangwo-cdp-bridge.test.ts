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
//   - 对外监听（0.0.0.0）+ 来源 IP 过滤：只放行本机回环与 ZeroTier/tailscale 组网网段
//   - XIANGWO_CDP_BIND=local/off、XIANGWO_CDP_ALLOW 覆盖、启动横幅日志
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  embeddedTargetId,
  XIANGWO_CDP_OPEN_BROWSER_PATH,
  XiangwoCdpBridge,
  type EmbeddedBrowserTarget,
  type XiangwoCdpBridgeOptions,
  type XiangwoCdpDebugger,
  type XiangwoCdpWebContents,
} from './xiangwo-cdp-bridge';
import {
  detectDefaultRouteAddress,
  isTailscaleAddress,
  type XiangwoCdpNetworkInterfaces,
} from './xiangwo-cdp-peers';

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
  /**
   * [XG-CUSTOM 2026-10-03] 真 Chromium 里 `Page.navigate` 之后 `getURL()` 就会变；假实现照做，
   * 否则「复用已有页也要导航」的分支会等满 XIANGWO_CDP_NAVIGATE_WAIT_MS（单测傻等 10s）。
   */
  onNavigate?: (url: string) => void;
  readonly sendCalls: Array<{
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  }> = [];
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
    if (method === 'Page.navigate') {
      const navigated = typeof params?.['url'] === 'string' ? params['url'] : '';
      if (navigated !== '') this.onNavigate?.(navigated);
    }
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
  // [XG-CUSTOM 2026-10-03] 模拟真导航：Page.navigate 之后 getURL()/getTitle() 立刻反映新页
  fake.debugger.onNavigate = (url) => {
    fake.url = url;
    fake.title = `导航后：${url}`;
  };
  return { browserId, webContents: fake, fake };
}

/** [XG-CUSTOM] 带 bot 维度的白名单目标（profileId/botId 由 registry 反推后传进来） */
function fakeBotTarget(browserId: string, profileId: string, botId: string): FakeTarget {
  return { ...fakeTarget(browserId), profileId, botId };
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

  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<Record<string, unknown>> {
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

  async waitForEvent(
    method: string,
    timeoutMs = 2500
  ): Promise<Record<string, unknown> | undefined> {
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

// 一个测试里可能同时活着好几个桥（来源过滤那几节），随机端口要**避免撞车**：
// 撞了就是 start() 返回 false（EADDRINUSE），看起来像"功能坏了"，其实是测试自己踩自己。
const usedPorts = new Set<number>();

function pickPort(): number {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const port = 19300 + Math.floor(Math.random() * 1500);
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  return 20800 + usedPorts.size;
}

async function startBridge(
  listTargets: () => EmbeddedBrowserTarget[],
  commandTimeoutMs = 500,
  options: Partial<XiangwoCdpBridgeOptions> = {}
): Promise<{ bridge: XiangwoCdpBridge; base: string }> {
  // [XG-CUSTOM] 端口是随机挑的，`usedPorts` 只在本文件内去重；整个目录并行跑时不同 worker
  // 之间仍会撞（撞了表现为 start() 返回 false，看起来像"功能坏了"）。撞了就换一个端口重试。
  let lastLogs: string[] = [];
  let lastPort = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = pickPort();
    lastPort = port;
    const startLogs: string[] = [];
    const userLog = options.log;
    const bridge = new XiangwoCdpBridge({
      listTargets,
      port,
      commandTimeoutMs,
      ...options,
      log: (message, metadata) => {
        startLogs.push(`${message} ${JSON.stringify(metadata ?? {})}`);
        userLog?.(message, metadata);
      },
    });
    running.push(bridge);
    const started = await bridge.start();
    if (started) return { bridge, base: `http://127.0.0.1:${port}` };
    // 起不来（几乎只可能是 EADDRINUSE）→ 把这次失败的桥丢掉，换端口重试
    bridge.stop();
    lastLogs = startLogs;
  }
  expect(false, `端口 ${lastPort} 连试 5 次都启动失败：${lastLogs.join(' | ')}`).toBe(true);
  throw new Error('unreachable');
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
    expect(list[0]?.['webSocketDebuggerUrl']).toContain(
      `/devtools/page/${embeddedTargetId('task-1')}`
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// [XG-CUSTOM] 对外监听 + 来源 IP 过滤（这一节是"装完即用"的安全收口，别删）
// ─────────────────────────────────────────────────────────────────────────────

function iface(address: string, internal = false, netmask = '255.255.255.0'): NetworkInterfaceInfo {
  return { address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null };
}

/** 现场：ZeroTier `ztu7tmyt7w` = 10.239.5.174/24（用户主力）+ tailscale 100.125.4.119/32 */
const MOCK_INTERFACES: XiangwoCdpNetworkInterfaces = {
  lo: [iface('127.0.0.1', true, '255.0.0.0')],
  ztu7tmyt7w: [iface('10.239.5.174')],
  tailscale0: [iface('100.125.4.119', false, '255.255.255.255')],
};

/** 本机真实网卡上的 LAN / ZeroTier / tailscale 地址（各取第一个，测试机上没有就是 null） */
function realAddresses(): {
  lan: string | null;
  zerotier: string | null;
  tailscale: string | null;
} {
  let lan: string | null = null;
  let zerotier: string | null = null;
  let tailscale: string | null = null;
  for (const [name, infos] of Object.entries(osNetworkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (/^zt|zerotier/i.test(name)) zerotier ??= info.address;
      else if (/tailscale/i.test(name) || isTailscaleAddress(info.address))
        tailscale ??= info.address;
      else lan ??= info.address;
    }
  }
  return { lan, zerotier, tailscale };
}

describe('[XG-CUSTOM] CDP 桥来源 IP 过滤（对外监听的安全边界）', () => {
  it('启动横幅打出"实际生效的允许来源"（含 ZeroTier 网段）与远端该填的地址', async () => {
    const logs: string[] = [];
    await startBridge(() => [fakeTarget('task-banner')], 500, {
      networkInterfaces: () => MOCK_INTERFACES,
      log: (message, metadata) =>
        logs.push(`${message}${metadata === undefined ? '' : ` ${JSON.stringify(metadata)}`}`),
    });

    const banner = logs.find((line) => line.includes('对外监听'));
    expect(banner).toBeDefined();
    expect(banner).toContain('对外监听 0.0.0.0:');
    expect(banner).toContain(
      '允许来源: 127.0.0.1/8, ::1, 10.239.5.0/24(ztu7tmyt7w), 100.64.0.0/10(tailscale0)'
    );
    // 远端（Linux agent）该填的地址也要直接打出来
    expect(logs.some((line) => line.includes('XIANGWO_WEBVIEW_CDP_URL=http://10.239.5.174:'))).toBe(
      true
    );
  });

  it('来源放行/拒绝：回环 + tailnet + ZeroTier 放行，同 /16 别的 /24、局域网、公网拒绝', async () => {
    const cases: Array<[string, boolean]> = [
      ['127.0.0.1', true],
      ['100.125.9.9', true], // tailscale 100.64.0.0/10
      ['10.239.5.9', true], // ZeroTier 10.239.5.0/24
      ['10.239.6.9', false], // 同 /16 的另一个 /24 → 不在 ZeroTier 网络里
      ['192.168.1.5', false],
      ['8.8.8.8', false],
    ];
    for (const [peer, allowed] of cases) {
      const logs: string[] = [];
      const { base } = await startBridge(() => [fakeTarget(`task-peer-${peer}`)], 500, {
        networkInterfaces: () => MOCK_INTERFACES,
        peerAddressOf: () => peer,
        log: (message) => logs.push(message),
      });
      const res = await fetch(`${base}/json/version`);
      expect(res.status, `来源 ${peer}`).toBe(allowed ? 200 : 403);
      if (allowed) {
        const body = (await res.json()) as Record<string, string>;
        expect(body['webSocketDebuggerUrl']).toContain('/devtools/browser/');
      } else {
        expect(await res.text()).toContain('不在允许列表内');
        expect(logs.some((line) => line.includes('拒绝非本机/非组网来源'))).toBe(true);
      }
    }
  });

  it('被拒来源连 WebSocket 也连不上（握手失败），且不会被登记成 CDP 客户端', async () => {
    const logs: string[] = [];
    const { base } = await startBridge(() => [fakeTarget('task-ws-deny')], 500, {
      networkInterfaces: () => MOCK_INTERFACES,
      peerAddressOf: () => '8.8.8.8',
      log: (message) => logs.push(message),
    });
    const port = new URL(base).port;
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 3000);
      const done = (value: string): void => {
        clearTimeout(timer);
        resolve(value);
      };
      const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/browser/XG-EMBEDDED-BROWSER`);
      socket.addEventListener('error', () => done('error'));
      socket.addEventListener('close', () => done('close'));
    });
    expect(['error', 'close']).toContain(outcome);
    expect(logs.some((line) => line.includes('拒绝非本机/非组网来源'))).toBe(true);
    expect(logs.some((line) => line.includes('CDP 客户端已连接'))).toBe(false);
  });

  it('XIANGWO_CDP_ALLOW 覆盖：只有指定网段 + 本机回环放行', async () => {
    const cases: Array<[string, boolean]> = [
      ['10.239.5.9', true],
      ['127.0.0.1', true],
      ['100.125.9.9', false], // 覆盖后 tailscale 不再自动放行
      ['10.239.6.9', false],
    ];
    for (const [peer, allowed] of cases) {
      const { base } = await startBridge(() => [fakeTarget('task-allow')], 500, {
        networkInterfaces: () => MOCK_INTERFACES,
        allowedPeers: ['10.239.5.0/24'],
        peerAddressOf: () => peer,
      });
      expect((await fetch(`${base}/json/list`)).status, `来源 ${peer}`).toBe(allowed ? 200 : 403);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [XG-CUSTOM] Windows 真机名形态 + 地址兜底 + 网卡清单日志
// （2026-09-30 真机反馈「Windows 上 ZeroTier 来源被拒」的直接回归）
// ─────────────────────────────────────────────────────────────────────────────

describe('[XG-CUSTOM] Windows 真机名形态与排障日志', () => {
  const WINDOWS_INTERFACES: XiangwoCdpNetworkInterfaces = {
    'ZeroTier One [8d1c312afafd650c]': [iface('10.239.5.218')],
    Tailscale: [iface('100.87.205.39', false, '255.255.255.255')],
  };

  it('ZeroTier One [8d1c312afafd650c] / Tailscale 都进白名单，且真机来源 10.239.5.x 能连上', async () => {
    const logs: string[] = [];
    const { base } = await startBridge(() => [fakeTarget('task-win')], 500, {
      networkInterfaces: () => WINDOWS_INTERFACES,
      peerAddressOf: () => '10.239.5.174',
      log: (message) => logs.push(message),
    });

    const banner = logs.find((line) => line.includes('对外监听'));
    expect(banner).toContain('10.239.5.0/24(ZeroTier One [8d1c312afafd650c])');
    expect(banner).toContain('100.64.0.0/10(Tailscale)');
    // 真机来源（ZeroTier 网段里的另一台机器）必须能连上
    expect((await fetch(`${base}/json/version`)).status).toBe(200);
  });

  it('启动日志打出每个网卡的判定明细（这次真机排障缺的就是它）', async () => {
    const logs: string[] = [];
    await startBridge(() => [fakeTarget('task-inventory')], 500, {
      networkInterfaces: () => ({
        ...WINDOWS_INTERFACES,
        '以太网 3': [iface('192.168.1.20')],
      }),
      log: (message) => logs.push(message),
    });

    expect(logs.some((line) => line.includes('网卡清单'))).toBe(true);
    const zerotierLine = logs.find((line) =>
      line.includes('命中: ZeroTier One [8d1c312afafd650c]')
    );
    expect(zerotierLine).toContain('10.239.5.218/255.255.255.0');
    expect(zerotierLine).toContain('匹配:zerotier(名字)');
    // 未命中的网卡也要在日志里（名字/地址都能看到，便于判断"是不是名字没匹配上"）
    expect(
      logs.some(
        (line) => line.includes('未命中（未进白名单）') && line.includes('以太网 3=192.168.1.20')
      )
    ).toBe(true);
    // 未匹配的私有网段 → 直接给出可粘贴的自救命令（候选一行、命令一行）
    expect(
      logs.some(
        (line) =>
          line.includes('未匹配的候选网段') &&
          line.includes('以太网 3=192.168.1.20(192.168.1.0/24)')
      )
    ).toBe(true);
    expect(logs.some((line) => line.includes('请设 XIANGWO_CDP_ALLOW=192.168.1.0/24'))).toBe(true);
  });

  it('地址兜底（用真机默认路由判定）：名字不认识但地址在 10/8 时仍然放行', async (ctx) => {
    const defaultRoute = await detectDefaultRouteAddress(1000);
    if (defaultRoute === null || defaultRoute.startsWith('10.')) {
      ctx.skip(); // 这台机器的默认路由就在 10/8 → 兜底规则按设计不生效
    }
    const logs: string[] = [];
    const { base } = await startBridge(() => [fakeTarget('task-fallback')], 500, {
      networkInterfaces: () => ({ '以太网 3': [iface('10.239.5.218')] }),
      peerAddressOf: () => '10.239.5.174',
      log: (message) => logs.push(message),
    });

    const banner = logs.find((line) => line.includes('对外监听'));
    expect(banner).toContain('10.239.5.0/24(以太网 3(地址兜底:10/8))');
    expect(logs.some((line) => line.includes('启用地址兜底'))).toBe(true);
    expect((await fetch(`${base}/json/version`)).status).toBe(200);
  });
});

describe('[XG-CUSTOM] CDP 桥监听模式与真实网卡（不 mock）', () => {
  it('bind=local：只 127.0.0.1 能连，非回环地址连不上', async () => {
    const { base } = await startBridge(() => [fakeTarget('task-local')], 500, { bind: 'local' });
    expect((await fetch(`${base}/json/list`)).status).toBe(200);
    const { lan } = realAddresses();
    if (lan === null) return; // 这台机器没有非回环 IPv4 → 没法验，跳过（CI 场景）
    const port = new URL(base).port;
    await expect(fetch(`http://${lan}:${port}/json/list`)).rejects.toThrow();
  });

  it('bind=off：不监听（start() 返回 false，端口不通）', async () => {
    const port = pickPort();
    const logs: string[] = [];
    const bridge = new XiangwoCdpBridge({
      listTargets: () => [],
      port,
      bind: 'off',
      log: (message) => logs.push(message),
    });
    running.push(bridge);
    expect(await bridge.start()).toBe(false);
    expect(logs.join(' ')).toContain('XIANGWO_CDP_BIND=off');
    await expect(fetch(`http://127.0.0.1:${port}/json/list`)).rejects.toThrow();
  });

  it('真实网卡：LAN 地址被拒、ZeroTier/tailscale 地址放行，且 ws 地址回填成客户端连的那个地址', async (ctx) => {
    const target = fakeTarget('task-real');
    const { base } = await startBridge(() => [target]);
    const port = new URL(base).port;
    const { lan, zerotier, tailscale } = realAddresses();

    if (lan !== null) {
      expect((await fetch(`http://${lan}:${port}/json/list`)).status, `LAN ${lan}`).toBe(403);
    }
    const groupAddresses = [zerotier, tailscale].filter((item): item is string => item !== null);
    if (groupAddresses.length === 0) ctx.skip(); // 这台机器没装 ZeroTier/tailscale

    for (const address of groupAddresses) {
      const version = await fetch(`http://${address}:${port}/json/version`);
      expect(version.status, `组网地址 ${address}`).toBe(200);
      expect(await version.text()).toContain(`ws://${address}:${port}/devtools/browser/`);

      const listRes = await fetch(`http://${address}:${port}/json/list`);
      expect(listRes.status, `组网地址 ${address}`).toBe(200);
      const list = (await listRes.json()) as Array<Record<string, string>>;
      // 只含内嵌浏览器，主窗口不在其中（白名单隔离不变）
      expect(list).toHaveLength(1);
      expect(list[0]?.['id']).toBe(embeddedTargetId('task-real'));
      expect(JSON.stringify(list)).not.toContain('EMDASH-MAIN-WINDOW');
      expect(list[0]?.['webSocketDebuggerUrl']).toContain(
        `ws://${address}:${port}/devtools/page/${embeddedTargetId('task-real')}`
      );
    }
  });
});

// ── [XG-CUSTOM 2026-10] 「从零开页」`POST /xg/open-browser` ────────────────────────
//
// 补的缺口很具体：9223 桥的白名单只含**已加载**的内嵌浏览器，所以一个 Browser 标签页都没开时
// agent「打开网站」在内嵌浏览器这条链上必然失败。这个端点把「请渲染进程开一个」做成可等待的
// 一次往返（HippoBuddy 的标记驱动自动开页同源，见 xiangwo-cdp-bridge.ts 注释）。
describe('[XG-CUSTOM] XiangwoCdpBridge /xg/open-browser（从零开页）', () => {
  async function postOpen(base: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${XIANGWO_CDP_OPEN_BROWSER_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  it('已有内嵌页 → 复用，不新开也不调开页回调', async () => {
    const target = fakeTarget('task-existing');
    const opened: string[] = [];
    const { base } = await startBridge(() => [target], 500, {
      requestOpenBrowser: (request) => opened.push(request.url),
    });
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['targetId']).toBe(embeddedTargetId('task-existing'));
    expect(opened).toHaveLength(0);
  });

  // [XG-CUSTOM] 回归：**复用一个已有内嵌页时也必须 Page.navigate**
  // （[XG-CUSTOM 2026-10-03] 修「打开网址无反应」）。
  // 病根：旧分支只回 `reused:true` 就走，页面留在原 URL —— agent 报"打开了"、用户看到的还是旧页
  // （本机实测：请求 yahoo.co.jp / g-mark.org / jagda.or.jp 全被 reused 吞掉，target 里始终只有
  // 最初那个 example.com）。所以这里同时锁三件事：命令真的发了、回包 url/title 是导航后的真值、
  // /json/list 里那一页也换了 URL。
  it('已有内嵌页 → 复用时也必须 Page.navigate，回包/清单都是导航后的真实结果', async () => {
    const target = fakeTarget('task-existing');
    const { base } = await startBridge(() => [target], 500);
    const wanted = 'https://www.g-mark.org/zh-CN';
    const r = await postOpen(base, { url: wanted });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['url']).toBe(wanted);
    expect(r['requestedUrl']).toBe(wanted);
    expect(r['previousUrl']).toBe('http://127.0.0.1:1933/studio/home');
    expect(String(r['title'])).toContain(wanted);
    expect(r['targetId']).toBe(embeddedTargetId('task-existing'));
    const navigated = target.fake.debugger.sendCalls.filter((c) => c.method === 'Page.navigate');
    expect(navigated).toHaveLength(1);
    expect(navigated[0]?.params).toEqual({ url: wanted });
    const list = (await (await fetch(`${base}/json/list`)).json()) as Array<
      Record<string, unknown>
    >;
    expect(list[0]?.['url']).toBe(wanted);
  });

  it('复用时导航失败 → ok:false + 人话（绝不回旧 URL 谎报成功）', async () => {
    const target = fakeTarget('task-broken');
    target.fake.debugger.sendCommand = async () => {
      throw new Error('模拟导航失败');
    };
    const { base } = await startBridge(() => [target], 500);
    const r = await postOpen(base, { url: 'https://www.g-mark.org/zh-CN' });
    expect(r['ok']).toBe(false);
    expect(r['reused']).toBe(true);
    expect(String(r['error'])).toContain('导航失败');
  });

  it('一个都没有 → 广播开页请求，等 target 出现后回报新 targetId', async () => {
    const bound: EmbeddedBrowserTarget[] = [];
    const news: FakeTarget[] = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 3000,
      requestOpenBrowser: (request) => {
        // 模拟渲染进程：收到广播后开标签页 → webview attach → bindWebContents（这里直接进白名单）
        expect(request.url).toBe('https://example.com');
        setTimeout(() => {
          const target = fakeTarget('task-auto-opened');
          target.fake.url = 'https://example.com/';
          news.push(target);
          bound.push(target);
        }, 50);
      },
    });
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(false);
    expect(r['targetId']).toBe(embeddedTargetId('task-auto-opened'));
    expect(news).toHaveLength(1);
  });

  it('渲染进程开不出来（超时）→ ok:false + 人话，不假装成功', async () => {
    const { base } = await startBridge(() => [], 500, {
      openBrowserWaitMs: 120,
      requestOpenBrowser: () => undefined,
    });
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(false);
    expect(String(r['error'])).toContain('没有页面被绑定');
  });

  it('没接开页回调（老行为）→ ok:false，且不会去动别的浏览器', async () => {
    const { base } = await startBridge(() => [], 500);
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(false);
    expect(String(r['error'])).toContain('没有接「从零开页」回调');
  });

  it('非 http(s) 或空 url → ok:false（不收任意字符串）', async () => {
    const { base } = await startBridge(() => [], 500, { requestOpenBrowser: () => undefined });
    expect((await postOpen(base, { url: 'file:///etc/passwd' }))['ok']).toBe(false);
    expect((await postOpen(base, { url: '   ' }))['ok']).toBe(false);
    expect((await postOpen(base, { nope: 1 }))['ok']).toBe(false);
  });

  it('请求体不是合法 JSON → ok:false（不抛、不 500）', async () => {
    const { base } = await startBridge(() => [], 500, { requestOpenBrowser: () => undefined });
    const res = await fetch(`${base}${XIANGWO_CDP_OPEN_BROWSER_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(false);
    expect(String(body['error'])).toContain('合法 JSON');
  });
});

// ── [XG-CUSTOM 2026-10-03] botId 必须被带到新页上（不是只带 url）────────────────────
//
// 病根（本机实测）：`/json/list` 里 7 个内嵌页的 `botId` 全是空，`POST /xg/open-browser
// {"url":X,"botId":"xg-mcp-probe"}` 也被忽略 —— agent 侧发的是 `botId`，桥只认 `bot`，
// 身份整条丢掉；就算认了，未绑定的 bot 也会落到 default（真实配置 = `isolated-per-task`），
// 那一页的 `profile`/`botId` 反推不出来。这三条钉住：别名要认、确定性 profile 要随请求下去、
// 回包与 /json/list 要回**真实** botId。
describe('[XG-CUSTOM] /xg/open-browser 的 botId（payload 不丢）', () => {
  async function postOpen(base: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${XIANGWO_CDP_OPEN_BROWSER_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  it('请求体写 botId（不是 bot）也是同一个维度：按 bot 挑页 + 复用也导航', async () => {
    const target = fakeBotTarget('task-sxsj', 'bot-sxsj', 'sxsj');
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(() => [target], 500, {
      lookupBotProfile: (bot) => (bot === 'sxsj' ? 'bot-sxsj' : null),
      requestOpenBrowser: (request) => opened.push({ ...request }),
    });
    const r = await postOpen(base, { url: 'https://example.com', botId: 'sxsj' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['profile']).toBe('bot-sxsj');
    expect(r['botId']).toBe('sxsj');
    expect(r['url']).toBe('https://example.com');
    expect(opened).toHaveLength(0);
    expect(target.fake.debugger.sendCalls.some((c) => c.method === 'Page.navigate')).toBe(true);
  });

  it('带 botId 开新页 → bot/profile 随开页请求下去，回包与 /json/list 都回真实 botId', async () => {
    const bound: EmbeddedBrowserTarget[] = [];
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 3000,
      // 本机真实状态：设置里一个 botId 绑定都没有
      lookupBotProfile: () => null,
      newBotProfileId: (botId) => `bot-${botId}`,
      requestOpenBrowser: (request) => {
        opened.push({ ...request });
        setTimeout(() => {
          const target = fakeBotTarget('task-probe', 'bot-xg-mcp-probe', 'xg-mcp-probe');
          target.fake.url = 'https://example.com/';
          bound.push(target);
        }, 50);
      },
    });
    const r = await postOpen(base, { url: 'https://example.com', botId: 'xg-mcp-probe' });
    expect(opened).toEqual([
      { url: 'https://example.com', bot: 'xg-mcp-probe', profile: 'bot-xg-mcp-probe' },
    ]);
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(false);
    expect(r['profile']).toBe('bot-xg-mcp-probe');
    expect(r['botId']).toBe('xg-mcp-probe');
    const list = (await (await fetch(`${base}/json/list`)).json()) as Array<
      Record<string, unknown>
    >;
    expect(list[0]?.['botId']).toBe('xg-mcp-probe');
    expect(list[0]?.['profile']).toBe('bot-xg-mcp-probe');
  });

  it('新页的 profile 对得上、但设置快照还没刷上 botId → 仍按 profile 归属回报请求的 botId', async () => {
    const bound: EmbeddedBrowserTarget[] = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 3000,
      lookupBotProfile: () => null,
      newBotProfileId: (botId) => `bot-${botId}`,
      requestOpenBrowser: () => {
        setTimeout(() => {
          // 渲染进程按同一个 id 建了 profile 并开页；主进程的设置快照（botId 反查）可能还没刷上
          const target: FakeTarget = {
            ...fakeTarget('task-lag'),
            profileId: 'bot-xg-mcp-probe',
          };
          target.fake.url = 'https://example.com/';
          bound.push(target);
        }, 50);
      },
    });
    const r = await postOpen(base, { url: 'https://example.com', botId: 'xg-mcp-probe' });
    expect(r['ok']).toBe(true);
    expect(r['profile']).toBe('bot-xg-mcp-probe');
    expect(r['botId']).toBe('xg-mcp-probe');
  });
});

// ── [XG-CUSTOM 2026-10-02] bot ⟷ 浏览器 profile：/json/list 回报身份 + open 只认自己那一页 ──
//
// 病根：设置里的 profile 是**全局**的（一个 Default + 手动 Add profile），所有内嵌浏览器共用
// 一份 cookie → agent 用 sxsj 的身份打开网页，实际接管的是 babado 已登录的标签页。
// 这条链的判据只有两个：① /json/list 里每页要能看出 profile/botId；
// ② 带 bot 的「从零开页」不许复用别人的页（宁可新开一个也不串登录态）。
describe('[XG-CUSTOM] bot ⟷ profile（/json/list 身份 + 按 bot 挑页）', () => {
  async function postOpen(base: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${XIANGWO_CDP_OPEN_BROWSER_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  it('/json/list 每页带 profile/botId；老字段一个不少', async () => {
    const { base } = await startBridge(
      () => [fakeBotTarget('task-sxsj', 'bot-sxsj', 'sxsj'), fakeTarget('task-plain')],
      500
    );
    const res = await fetch(`${base}/json/list`);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    const sxsj = list.find((item) => item['browserId'] === 'task-sxsj');
    const plain = list.find((item) => item['browserId'] === 'task-plain');
    expect(sxsj?.['profile']).toBe('bot-sxsj');
    expect(sxsj?.['botId']).toBe('sxsj');
    // 认不出 profile 的页（比如 per-task 隔离分区）回报空串，而不是漏字段
    expect(plain?.['profile']).toBe('');
    expect(plain?.['botId']).toBe('');
    // browser-use / agent 依赖的旧字段仍在
    expect(typeof sxsj?.['id']).toBe('string');
    expect(typeof sxsj?.['title']).toBe('string');
    expect(String(sxsj?.['webSocketDebuggerUrl'])).toContain('/devtools/page/');
  });

  it('不带 bot/profile → 复用第一个已绑定的页（与改动前逐字节一致）', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(
      () => [fakeBotTarget('task-babado', 'bot-babado', 'babado')],
      500,
      { requestOpenBrowser: (request) => opened.push({ ...request }) }
    );
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['targetId']).toBe(embeddedTargetId('task-babado'));
    expect(opened).toHaveLength(0);
  });

  it('带 bot 且已有它自己的页 → 复用那一页（不新开）', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(
      () => [
        fakeBotTarget('task-babado', 'bot-babado', 'babado'),
        fakeBotTarget('task-sxsj', 'bot-sxsj', 'sxsj'),
      ],
      500,
      {
        requestOpenBrowser: (request) => opened.push({ ...request }),
        lookupBotProfile: (bot) => (bot === 'sxsj' ? 'bot-sxsj' : null),
      }
    );
    const r = await postOpen(base, { url: 'https://example.com', bot: 'sxsj' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['targetId']).toBe(embeddedTargetId('task-sxsj'));
    expect(r['profile']).toBe('bot-sxsj');
    expect(r['botId']).toBe('sxsj');
    expect(opened).toHaveLength(0);
  });

  it('带 bot 但只有别人的页 → 绝不复用，改为广播开自己的页（bot 随广播带下去）', async () => {
    const bound: EmbeddedBrowserTarget[] = [fakeBotTarget('task-babado', 'bot-babado', 'babado')];
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 3000,
      lookupBotProfile: (bot) => (bot === 'sxsj' ? 'bot-sxsj' : null),
      requestOpenBrowser: (request) => {
        opened.push({ ...request });
        setTimeout(() => {
          const target = fakeBotTarget('task-sxsj', 'bot-sxsj', 'sxsj');
          target.fake.url = 'https://example.com/';
          bound.push(target);
        }, 50);
      },
    });
    const r = await postOpen(base, { url: 'https://example.com', bot: 'sxsj' });
    // [XG-CUSTOM 2026-10-03] 广播里带上**已解析好的 profile**：渲染进程按同一个 id 建/用那一页，
    // 否则主进程"等哪个 profile"与实际开出来的页可能对不上（botId 也就回不来）。
    expect(opened).toEqual([{ url: 'https://example.com', bot: 'sxsj', profile: 'bot-sxsj' }]);
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(false);
    expect(r['targetId']).toBe(embeddedTargetId('task-sxsj'));
    expect(r['botId']).toBe('sxsj');
  });

  it('显式 profile 优先于 bot（两个都给时按 profile 挑）', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(
      () => [fakeBotTarget('task-babado', 'bot-babado', 'babado')],
      500,
      { requestOpenBrowser: (request) => opened.push({ ...request }) }
    );
    const r = await postOpen(base, {
      url: 'https://example.com',
      bot: 'sxsj',
      profile: 'bot-babado',
    });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['targetId']).toBe(embeddedTargetId('task-babado'));
    expect(opened).toHaveLength(0);
  });

  it('bot 没绑定任何 profile → 不做精确匹配（走老行为，不猜 default）', async () => {
    const opened: Array<Record<string, unknown>> = [];
    const { base } = await startBridge(
      () => [fakeBotTarget('task-other', 'bot-other', 'other')],
      500,
      {
        requestOpenBrowser: (request) => opened.push({ ...request }),
        lookupBotProfile: () => null,
      }
    );
    const r = await postOpen(base, { url: 'https://example.com', bot: 'scout' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(opened).toHaveLength(0);
  });

  it('广播等不到"profile 对得上"的新页 → ok:false（不拿别人的页凑数）', async () => {
    const bound: EmbeddedBrowserTarget[] = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 200,
      lookupBotProfile: (bot) => (bot === 'sxsj' ? 'bot-sxsj' : null),
      requestOpenBrowser: () => {
        setTimeout(() => bound.push(fakeBotTarget('task-babado', 'bot-babado', 'babado')), 30);
      },
    });
    const r = await postOpen(base, { url: 'https://example.com', bot: 'sxsj' });
    expect(r['ok']).toBe(false);
    expect(String(r['error'])).toContain('没有页面被绑定');
  });
});
