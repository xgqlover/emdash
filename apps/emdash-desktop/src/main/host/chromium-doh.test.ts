/**
 * [XG-CUSTOM] 2026-10-06 —— DoH 配制的 node 单测（纯函数 + 两条落地路径）。
 * 覆盖：**缺省 / 覆盖 / 关闭 / 非法模板要忽略并 warn**，以及
 * `configureDohCommandLine`（ready 之前）/ `configureDohHostResolver`（ready 之后，
 * 这才是 Electron 40 上真正生效的那条）两个 apply 函数。
 *
 * [XG-CUSTOM] 2026-10-06 —— **第三轮补充**（"secure 不许闭死"）：
 *   · `decideDohHostResolverConfig` 的**决策表**逐条断言（探测通过/不通/跳过/关闭/无模板）；
 *   · 探测不通 ⇒ **一次都不调用** `app.configureHostResolver`（这是"不 DNS 全灭"的判据）；
 *   · `probeDohReachability` 的超时/非 2xx/错 content-type 三条失败路径；
 *   · 诊断日志前缀恒为 `[XG-CUSTOM] DoH:`，且 `XIANGWO_DOH=0` 会**明确**打一句"按配置关闭"。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  configureDohCommandLine,
  configureDohHostResolver,
  decideDohHostResolverConfig,
  DEFAULT_DOH_TEMPLATE,
  DOH_PROBE_TIMEOUT_MS,
  probeDohReachability,
  resolveDohCommandLineSwitches,
  resolveProbeTimeoutMs,
  type DohProbeResult,
} from './chromium-doh';

function createCommandLine() {
  return { appendSwitch: vi.fn() };
}

function createApp() {
  return { configureHostResolver: vi.fn() };
}

const OK_PROBE: DohProbeResult = { ran: true, ok: true, ms: 42, reason: 'ok' };
const FAILED_PROBE: DohProbeResult = {
  ran: true,
  ok: false,
  ms: 1200,
  reason: '探测超时（1200ms）',
};
const SKIPPED_PROBE: DohProbeResult = { ran: false, ok: false, ms: 0, reason: '未探测' };
const probeStub = (result: DohProbeResult) => vi.fn(async () => result);

describe('resolveDohCommandLineSwitches', () => {
  it('缺省：secure 模式 + 我们的默认模板', () => {
    const plan = resolveDohCommandLineSwitches({});

    expect(plan.switches).toEqual([
      { name: 'dns-over-https-mode', value: 'secure' },
      { name: 'dns-over-https-templates', value: DEFAULT_DOH_TEMPLATE },
    ]);
    expect(plan.template).toBe(DEFAULT_DOH_TEMPLATE);
    expect(plan.warning).toBeNull();
  });

  it('XIANGWO_DOH_TEMPLATE 覆盖模板', () => {
    const plan = resolveDohCommandLineSwitches({
      XIANGWO_DOH_TEMPLATE: ' https://doh.example/dns-query ',
    });

    expect(plan.switches).toEqual([
      { name: 'dns-over-https-mode', value: 'secure' },
      { name: 'dns-over-https-templates', value: 'https://doh.example/dns-query' },
    ]);
    expect(plan.template).toBe('https://doh.example/dns-query');
    expect(plan.warning).toBeNull();
  });

  it.each(['0', 'off', 'OFF', ' 0 '])('XIANGWO_DOH=%j ⇒ 一个开关都不加（零回归回退）', (value) => {
    const plan = resolveDohCommandLineSwitches({
      XIANGWO_DOH: value,
      XIANGWO_DOH_TEMPLATE: 'https://doh.example/dns-query',
    });

    expect(plan.switches).toEqual([]);
    expect(plan.template).toBeNull();
    expect(plan.warning).toBeNull();
  });

  it.each([
    'not-a-url',
    'ftp://doh.example/dns-query',
    'https://',
    'xg.xgqsxsj.dpdns.org/dns-query',
  ])('非法模板 %j 被忽略 + warn，仍走默认模板', (value) => {
    const plan = resolveDohCommandLineSwitches({ XIANGWO_DOH_TEMPLATE: value });

    expect(plan.switches).toEqual([
      { name: 'dns-over-https-mode', value: 'secure' },
      { name: 'dns-over-https-templates', value: DEFAULT_DOH_TEMPLATE },
    ]);
    expect(plan.template).toBe(DEFAULT_DOH_TEMPLATE);
    expect(plan.warning).toContain(value.trim());
  });
});

describe('configureDohCommandLine', () => {
  it('按顺序 append 两个开关，默认不 warn', () => {
    const commandLine = createCommandLine();
    const warn = vi.fn();

    configureDohCommandLine({ commandLine, env: {}, warn });

    expect(commandLine.appendSwitch.mock.calls).toEqual([
      ['dns-over-https-mode', 'secure'],
      ['dns-over-https-templates', DEFAULT_DOH_TEMPLATE],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('XIANGWO_DOH=0 ⇒ 完全不碰 commandLine（逐字节回到改动前）', () => {
    const commandLine = createCommandLine();
    const warn = vi.fn();

    configureDohCommandLine({ commandLine, env: { XIANGWO_DOH: '0' }, warn });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('非法模板：忽略 + 走默认模板 + warn 一句（带 [XG-CUSTOM] 前缀）', () => {
    const commandLine = createCommandLine();
    const warn = vi.fn();

    configureDohCommandLine({
      commandLine,
      env: { XIANGWO_DOH_TEMPLATE: 'http://insecure.example/dns-query' },
      warn,
    });

    expect(commandLine.appendSwitch).toHaveBeenCalledWith(
      'dns-over-https-templates',
      DEFAULT_DOH_TEMPLATE
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] .*XIANGWO_DOH_TEMPLATE/);
  });

  it('不传 env 时读 process.env（缺省即开启）', () => {
    const commandLine = createCommandLine();
    const previous = process.env.XIANGWO_DOH;
    delete process.env.XIANGWO_DOH;
    try {
      configureDohCommandLine({ commandLine });
    } finally {
      if (previous !== undefined) process.env.XIANGWO_DOH = previous;
    }

    expect(commandLine.appendSwitch).toHaveBeenCalledWith('dns-over-https-mode', 'secure');
  });

  // [XG-CUSTOM] 2026-10-06 —— 诊断日志前缀统一（真机 grep 判案用）
  it('给了 logger ⇒ 打一句 [XG-CUSTOM] DoH: 前缀的解析结果；不给则一句不打', () => {
    const withLogger = vi.fn();
    configureDohCommandLine({ commandLine: createCommandLine(), env: {}, logger: withLogger });

    expect(withLogger).toHaveBeenCalledTimes(1);
    expect(withLogger.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] DoH: /);
    expect(withLogger.mock.calls[0]?.[1]).toMatchObject({
      enabled: true,
      template: DEFAULT_DOH_TEMPLATE,
    });

    const withoutLogger = vi.fn();
    configureDohCommandLine({ commandLine: createCommandLine(), env: {}, warn: withoutLogger });
    expect(withoutLogger).not.toHaveBeenCalled();
  });
});

// ───────── [XG-CUSTOM] 2026-10-06 决策表（纯函数）：可达=secure / 不可达=不配 / 关闭=不配 ─────────
describe('decideDohHostResolverConfig', () => {
  const plan = () => resolveDohCommandLineSwitches({});

  it('探测通过 ⇒ secure + 我们的模板', () => {
    const decision = decideDohHostResolverConfig({ plan: plan(), probe: OK_PROBE, env: {} });

    expect(decision).toEqual({
      configure: true,
      mode: 'secure',
      template: DEFAULT_DOH_TEMPLATE,
      reason: 'probe-ok',
    });
  });

  it('探测不通 ⇒ configure:false（**不配**，保持系统解析器；绝不 DNS 全灭）', () => {
    const decision = decideDohHostResolverConfig({ plan: plan(), probe: FAILED_PROBE, env: {} });

    expect(decision.configure).toBe(false);
    expect(decision.mode).toBeNull();
    expect(decision.reason).toBe('probe-failed');
  });

  it('XIANGWO_DOH=0 ⇒ configure:false + reason=disabled-by-env（完全不配）', () => {
    const offPlan = resolveDohCommandLineSwitches({ XIANGWO_DOH: '0' });
    const decision = decideDohHostResolverConfig({
      plan: offPlan,
      probe: OK_PROBE,
      env: { XIANGWO_DOH: '0' },
    });

    expect(decision).toEqual({
      configure: false,
      mode: null,
      template: null,
      reason: 'disabled-by-env',
    });
  });

  it('XIANGWO_DOH_PROBE=0 ⇒ 跳过探测，直接 secure（旧行为，排障用）', () => {
    const decision = decideDohHostResolverConfig({
      plan: plan(),
      probe: SKIPPED_PROBE,
      env: { XIANGWO_DOH_PROBE: '0' },
    });

    expect(decision.configure).toBe(true);
    expect(decision.reason).toBe('probe-skipped-by-env');
  });

  it('没跳过却也没跑探测 ⇒ configure:false（宁可不配，不赌）', () => {
    const decision = decideDohHostResolverConfig({ plan: plan(), probe: SKIPPED_PROBE, env: {} });

    expect(decision.configure).toBe(false);
    expect(decision.reason).toBe('probe-not-run');
  });
});

describe('resolveProbeTimeoutMs', () => {
  it('缺省 = 3s，且永远不超过硬上限 3.5s', () => {
    expect(resolveProbeTimeoutMs({})).toBe(DOH_PROBE_TIMEOUT_MS);
    expect(resolveProbeTimeoutMs({ XIANGWO_DOH_PROBE_MS: '800' })).toBe(800);
    expect(resolveProbeTimeoutMs({ XIANGWO_DOH_PROBE_MS: '99999' })).toBe(3500);
    expect(resolveProbeTimeoutMs({ XIANGWO_DOH_PROBE_MS: 'abc' })).toBe(DOH_PROBE_TIMEOUT_MS);
  });
});

describe('probeDohReachability', () => {
  const okResponse = () =>
    new Response(new Uint8Array([0x12, 0x34]), {
      status: 200,
      headers: { 'content-type': 'application/dns-message' },
    });

  it('2xx + application/dns-message ⇒ ok', async () => {
    const seen: unknown[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(input);
      return okResponse();
    }) as never;
    const result = await probeDohReachability(DEFAULT_DOH_TEMPLATE, { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.ran).toBe(true);
    expect(seen[0]).toBe(DEFAULT_DOH_TEMPLATE);
  });

  it('非 2xx ⇒ 不通（带 HTTP 状态码）', async () => {
    const result = await probeDohReachability(DEFAULT_DOH_TEMPLATE, {
      fetchImpl: (async () => new Response('nope', { status: 502 })) as never,
    });

    expect(result).toMatchObject({ ran: true, ok: false, reason: 'HTTP 502' });
  });

  it('2xx 但不是 dns-message（门户/劫持）⇒ 不通', async () => {
    const result = await probeDohReachability(DEFAULT_DOH_TEMPLATE, {
      fetchImpl: (async () =>
        new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as never,
    });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('content-type');
  });

  it('fetch 永不返回 ⇒ 按超时判不通，且不会拖过 timeoutMs', async () => {
    const startedAt = Date.now();
    const result = await probeDohReachability(DEFAULT_DOH_TEMPLATE, {
      timeoutMs: 60,
      fetchImpl: (() => new Promise(() => {})) as never,
    });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('探测超时');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('fetch 抛错 ⇒ 不通（原因原文）', async () => {
    const result = await probeDohReachability(DEFAULT_DOH_TEMPLATE, {
      fetchImpl: (async () => {
        throw new Error('ENOTFOUND');
      }) as never,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ENOTFOUND');
  });
});

// [XG-CUSTOM] 2026-10-06 —— Electron 40 实测：命令行开关没人理，真正生效的是
// `app.configureHostResolver`（ready 之后），所以这几条断言的是**实际生效**的那条路。
describe('configureDohHostResolver', () => {
  it('探测通过：secure + 我们的模板（并打"前后"两句日志）', async () => {
    const app = createApp();
    const warn = vi.fn();
    const logger = vi.fn();

    await configureDohHostResolver({ app, env: {}, warn, logger, probe: probeStub(OK_PROBE) });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: [DEFAULT_DOH_TEMPLATE],
    });
    expect(warn).not.toHaveBeenCalled();
    const lines = logger.mock.calls.map((call) => String(call[0]));
    expect(lines.every((line) => line.startsWith('[XG-CUSTOM] DoH: '))).toBe(true);
    expect(lines).toContain('[XG-CUSTOM] DoH: 调用 app.configureHostResolver 之前');
    expect(lines).toContain('[XG-CUSTOM] DoH: 调用 app.configureHostResolver 之后（未抛错）');
  });

  it('探测不通 ⇒ **一次都不调用** configureHostResolver，并 warn 说明原因', async () => {
    const app = createApp();
    const logger = vi.fn();

    const decision = await configureDohHostResolver({
      app,
      env: {},
      warn: vi.fn(),
      logger,
      probe: probeStub(FAILED_PROBE),
    });

    expect(app.configureHostResolver).not.toHaveBeenCalled();
    expect(decision.reason).toBe('probe-failed');
    const lines = logger.mock.calls.map((call) => String(call[0])).join('\n');
    expect(lines).toContain('[XG-CUSTOM] DoH: 可达性探测未通过');
    expect(lines).toContain('不配 secure');
  });

  it('XIANGWO_DOH=0 ⇒ 不调 API + **明确**打一句"按配置关闭"', async () => {
    const app = createApp();
    const logger = vi.fn();

    await configureDohHostResolver({
      app,
      env: { XIANGWO_DOH: '0' },
      warn: vi.fn(),
      logger,
      probe: probeStub(OK_PROBE),
    });

    expect(app.configureHostResolver).not.toHaveBeenCalled();
    expect(logger.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      '[XG-CUSTOM] DoH: 按配置关闭'
    );
  });

  it('XIANGWO_DOH=off ⇒ 一次都不调用（零回归回退），不探测', async () => {
    const app = createApp();
    const warn = vi.fn();
    const probe = probeStub(OK_PROBE);

    await configureDohHostResolver({ app, env: { XIANGWO_DOH: 'off' }, warn, probe });

    expect(app.configureHostResolver).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('XIANGWO_DOH_TEMPLATE 覆盖时用覆盖值', async () => {
    const app = createApp();

    await configureDohHostResolver({
      app,
      env: { XIANGWO_DOH_TEMPLATE: 'https://doh.example/dns-query' },
      warn: vi.fn(),
      probe: probeStub(OK_PROBE),
    });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://doh.example/dns-query'],
    });
  });

  it('非法模板 → warn 并回落默认模板', async () => {
    const app = createApp();
    const warn = vi.fn();

    await configureDohHostResolver({
      app,
      env: { XIANGWO_DOH_TEMPLATE: 'nope' },
      warn,
      probe: probeStub(OK_PROBE),
    });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: [DEFAULT_DOH_TEMPLATE],
    });
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] .*XIANGWO_DOH_TEMPLATE/);
  });

  it('老 Electron 没有这个 API ⇒ warn 但不抛（不把 boot 打死）', async () => {
    const warn = vi.fn();

    await expect(
      configureDohHostResolver({ app: {} as never, env: {}, warn, probe: probeStub(OK_PROBE) })
    ).resolves.toBeDefined();

    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] .*configureHostResolver/);
  });

  it('API 抛错也吞掉并 warn（DoH 配不上不该拖垮启动），原文进日志', async () => {
    const app = {
      configureHostResolver: vi.fn(() => {
        throw new Error('Cannot configure host resolver after it has been used');
      }),
    };
    const warn = vi.fn();
    const logger = vi.fn();

    const decision = await configureDohHostResolver({
      app,
      env: {},
      warn,
      logger,
      probe: probeStub(OK_PROBE),
    });

    expect(warn.mock.calls[0]?.[0]).toContain('Cannot configure host resolver');
    expect(decision.configure).toBe(false);
    expect(logger.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      '调用 app.configureHostResolver 抛出异常'
    );
  });

  it('不传 probe 时走真实探测实现（这里 stub 掉全局 fetch，避免真联网）', async () => {
    const app = createApp();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([0x12, 0x34]), {
        status: 200,
        headers: { 'content-type': 'application/dns-message' },
      })) as typeof fetch;
    try {
      await configureDohHostResolver({ app, env: {}, warn: vi.fn() });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(app.configureHostResolver).toHaveBeenCalledTimes(1);
  });
});
