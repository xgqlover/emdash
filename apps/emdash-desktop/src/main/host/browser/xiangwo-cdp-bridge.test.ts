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
      requestOpenBrowser: (url) => opened.push(url),
    });
    const r = await postOpen(base, { url: 'https://example.com' });
    expect(r['ok']).toBe(true);
    expect(r['reused']).toBe(true);
    expect(r['targetId']).toBe(embeddedTargetId('task-existing'));
    expect(opened).toHaveLength(0);
  });

  it('一个都没有 → 广播开页请求，等 target 出现后回报新 targetId', async () => {
    const bound: EmbeddedBrowserTarget[] = [];
    const news: FakeTarget[] = [];
    const { base } = await startBridge(() => bound, 500, {
      openBrowserWaitMs: 3000,
      requestOpenBrowser: (url) => {
        // 模拟渲染进程：收到广播后开标签页 → webview attach → bindWebContents（这里直接进白名单）
        expect(url).toBe('https://example.com');
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
