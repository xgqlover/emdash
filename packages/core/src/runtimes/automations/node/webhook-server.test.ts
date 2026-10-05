import type { Logger } from '@emdash/shared/logger';
// [XG-CUSTOM 2026-10-05] 事件触发**摄取端**回归测试（webhook-server.ts）。
//
// 真起一个 127.0.0.1 的服务器（端口 0 让系统分配）+ 真发 HTTP 请求，只断言"外部可见的事实"：
//   路由（404/方法）· 鉴权（401 缺 token / 403 错 token / 403 未知 id）· 体积（413）· 格式（400）
//   命中（202 + onEvent）· 过滤不匹配与**畸形表达式**都 204 且不回调（fail-closed）
//   没目标时**根本不起监听**；目标清空后自动停；stop 后连不上
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_WEBHOOK_PATH_PREFIX,
  AUTOMATION_WEBHOOK_TOKEN_HEADER,
  AutomationWebhookServer,
  type WebhookTarget,
} from './webhook-server';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const servers: AutomationWebhookServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

function makeServer(input: {
  targets: () => WebhookTarget[];
  onEvent?: (target: WebhookTarget, text: string, payload: unknown) => void;
  maxBodyBytes?: number;
}): AutomationWebhookServer {
  const server = new AutomationWebhookServer({
    listTargets: input.targets,
    onEvent: input.onEvent ?? (() => {}),
    logger,
    port: 0,
    maxBodyBytes: input.maxBodyBytes,
  });
  servers.push(server);
  return server;
}

const TOKEN = 'test-token-0123456789';
const TARGET: WebhookTarget = {
  automationId: 'auto-1',
  token: TOKEN,
  filter: 'action == "opened"',
};

async function post(
  port: number,
  path: string,
  options: { token?: string; body?: string; method?: string; id?: string } = {}
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: options.method ?? 'POST',
    headers:
      options.token === undefined ? {} : { [AUTOMATION_WEBHOOK_TOKEN_HEADER]: options.token },
    body: options.method === 'GET' ? undefined : (options.body ?? '{}'),
  });
  return response.status;
}

describe('AutomationWebhookServer', () => {
  it('没有目标 → 不起监听（绝不白占端口）', async () => {
    const server = makeServer({ targets: () => [] });
    expect(await server.ensureStarted()).toBeNull();
    expect(server.listeningPort).toBe(0);
  });

  it('有目标才监听，且只绑 127.0.0.1', async () => {
    const server = makeServer({ targets: () => [TARGET] });
    const started = await server.ensureStarted();
    expect(started?.port).toBeGreaterThan(0);
    expect(server.listeningPort).toBeGreaterThan(0);
    // 远端地址（非 loopback）应连不上：用一个本机非 loopback 地址试
    const status = await post(started!.port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, {
      token: TOKEN,
      body: '{"action":"opened"}',
    });
    expect(status).toBe(202);
  });

  it('路由：非 POST 或路径不对 → 404', async () => {
    const server = makeServer({ targets: () => [TARGET] });
    const { port } = (await server.ensureStarted())!;
    expect(
      await post(port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, { token: TOKEN, method: 'GET' })
    ).toBe(404);
    expect(await post(port, '/other', { token: TOKEN, body: '{}' })).toBe(404);
    expect(await post(port, '/', { token: TOKEN, body: '{}' })).toBe(404);
  });

  it('鉴权：缺 token 401 / 错 token 403（长度不同也不抛）/ 未知 id 403', async () => {
    const server = makeServer({ targets: () => [TARGET] });
    const { port } = (await server.ensureStarted())!;
    const path = `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`;
    expect(await post(port, path, { body: '{}' })).toBe(401);
    expect(await post(port, path, { token: 'x'.repeat(TOKEN.length), body: '{}' })).toBe(403);
    expect(await post(port, path, { token: 'short', body: '{}' })).toBe(403);
    expect(
      await post(port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}nope`, { token: TOKEN, body: '{}' })
    ).toBe(403);
  });

  it('格式：坏 JSON → 400；超体积 → 413', async () => {
    const server = makeServer({ targets: () => [TARGET], maxBodyBytes: 64 });
    const { port } = (await server.ensureStarted())!;
    const path = `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`;
    expect(await post(port, path, { token: TOKEN, body: '{ 这不是 json' })).toBe(400);
    expect(await post(port, path, { token: TOKEN, body: `{"a":"${'x'.repeat(200)}"}` })).toBe(413);
  });

  it('命中：202 + onEvent 收到解析后的 payload', async () => {
    const onEvent = vi.fn();
    const server = makeServer({ targets: () => [TARGET], onEvent });
    const { port } = (await server.ensureStarted())!;
    const body = '{"action":"opened","repository":{"name":"emdash"}}';
    const status = await post(port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, {
      token: TOKEN,
      body,
    });
    expect(status).toBe(202);
    expect(onEvent).toHaveBeenCalledTimes(1);
    const [target, text, payload] = onEvent.mock.calls[0]!;
    expect(target.automationId).toBe('auto-1');
    expect(text).toBe(body);
    expect(payload).toEqual({ action: 'opened', repository: { name: 'emdash' } });
  });

  it('过滤不匹配 / 畸形表达式 → 204 且**不回调**（fail-closed）', async () => {
    const onEvent = vi.fn();
    const server = makeServer({ targets: () => [TARGET], onEvent });
    const { port } = (await server.ensureStarted())!;
    const path = `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`;
    expect(await post(port, path, { token: TOKEN, body: '{"action":"closed"}' })).toBe(204);
    expect(onEvent).not.toHaveBeenCalled();

    const broken = makeServer({
      targets: () => [{ automationId: 'auto-2', token: TOKEN, filter: 'action ==' }],
      onEvent,
    });
    const second = (await broken.ensureStarted())!;
    expect(
      await post(second.port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-2`, {
        token: TOKEN,
        body: '{"action":"opened"}',
      })
    ).toBe(204);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('目标清空 → 自动停监听；stop 后连不上', async () => {
    let targets: WebhookTarget[] = [TARGET];
    const server = makeServer({ targets: () => targets });
    const { port } = (await server.ensureStarted())!;
    expect(
      await post(port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, {
        token: TOKEN,
        body: '{"action":"opened"}',
      })
    ).toBe(202);

    targets = [];
    expect(await server.ensureStarted()).toBeNull();
    expect(server.listeningPort).toBe(0);
    await expect(
      post(port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, {
        token: TOKEN,
        body: '{"action":"opened"}',
      })
    ).rejects.toBeTruthy();

    const server2 = makeServer({ targets: () => [TARGET] });
    const second = (await server2.ensureStarted())!;
    server2.stop();
    await expect(
      post(second.port, `${AUTOMATION_WEBHOOK_PATH_PREFIX}auto-1`, {
        token: TOKEN,
        body: '{"action":"opened"}',
      })
    ).rejects.toBeTruthy();
  });
});
