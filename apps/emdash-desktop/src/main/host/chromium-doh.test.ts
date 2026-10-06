/**
 * [XG-CUSTOM] 2026-10-06 —— DoH 配制的 node 单测（纯函数 + 两条落地路径）。
 * 覆盖：**缺省 / 覆盖 / 关闭 / 非法模板要忽略并 warn**，以及
 * `configureDohCommandLine`（ready 之前）/ `configureDohHostResolver`（ready 之后，
 * 这才是 Electron 40 上真正生效的那条）两个 apply 函数。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  configureDohCommandLine,
  configureDohHostResolver,
  DEFAULT_DOH_TEMPLATE,
  resolveDohCommandLineSwitches,
} from './chromium-doh';

function createCommandLine() {
  return { appendSwitch: vi.fn() };
}

function createApp() {
  return { configureHostResolver: vi.fn() };
}

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
});

// [XG-CUSTOM] 2026-10-06 —— Electron 40 实测：命令行开关没人理，真正生效的是
// `app.configureHostResolver`（ready 之后），所以这几条断言的是**实际生效**的那条路。
describe('configureDohHostResolver', () => {
  it('缺省：secure + 我们的模板', () => {
    const app = createApp();
    const warn = vi.fn();

    configureDohHostResolver({ app, env: {}, warn });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: [DEFAULT_DOH_TEMPLATE],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('XIANGWO_DOH_TEMPLATE 覆盖时用覆盖值', () => {
    const app = createApp();

    configureDohHostResolver({
      app,
      env: { XIANGWO_DOH_TEMPLATE: 'https://doh.example/dns-query' },
      warn: vi.fn(),
    });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://doh.example/dns-query'],
    });
  });

  it('XIANGWO_DOH=off ⇒ 一次都不调用（零回归回退）', () => {
    const app = createApp();
    const warn = vi.fn();

    configureDohHostResolver({ app, env: { XIANGWO_DOH: 'off' }, warn });

    expect(app.configureHostResolver).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('非法模板 → warn 并回落默认模板', () => {
    const app = createApp();
    const warn = vi.fn();

    configureDohHostResolver({ app, env: { XIANGWO_DOH_TEMPLATE: 'nope' }, warn });

    expect(app.configureHostResolver).toHaveBeenCalledWith({
      secureDnsMode: 'secure',
      secureDnsServers: [DEFAULT_DOH_TEMPLATE],
    });
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] .*XIANGWO_DOH_TEMPLATE/);
  });

  it('老 Electron 没有这个 API ⇒ warn 但不抛（不把 boot 打死）', () => {
    const warn = vi.fn();

    expect(() => configureDohHostResolver({ app: {} as never, env: {}, warn })).not.toThrow();

    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[XG-CUSTOM\] .*configureHostResolver/);
  });

  it('API 抛错也吞掉并 warn（DoH 配不上不该拖垮启动）', () => {
    const app = {
      configureHostResolver: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const warn = vi.fn();

    configureDohHostResolver({ app, env: {}, warn });

    expect(warn.mock.calls[0]?.[0]).toContain('boom');
  });
});
