// [XG-CUSTOM 2026-10-02] 多候选地址 + 自动切换 单测。
//
// 覆盖三件事（都是用户明确要的证据）：
//   1. **一条路断了自动切到下一条**（不需要重启、不需要等待退避）；
//   2. **记住上次成功的那个**（内存 + 落盘，跨进程重启）；
//   3. 不抢 relay 既有的"本机就是 agent → 自我停用"判定（家里 Linux 不能被本改动弄坏）。
//
// 另有一组**真 socket** 用例（`node:http` 起真服务器）：证明探针真的能区分"活的 8900"
// 与"黑洞地址"，并且超时确实在 2s 内返回。
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRelayCandidates,
  classifyCandidateUrl,
  dedupeCandidates,
  normalizeBaseUrl,
  parseRelayCandidateEnv,
  probeRelayCandidate,
  RelayCandidateSelector,
  XIANGWO_RELAY_DEFAULT_CANDIDATE_URLS,
  type RelayCandidate,
  type RelayCandidateHealth,
} from './xiangwo-relay-candidates';

// ── 纯逻辑：候选池 ──────────────────────────────────────────────────────────

describe('[XG-CUSTOM] 候选池构造', () => {
  it('缺省顺序：直连网线 > ZeroTier > tailscale > 本机', () => {
    const list = buildRelayCandidates({});
    expect(list.map((c) => c.url)).toEqual([...XIANGWO_RELAY_DEFAULT_CANDIDATE_URLS]);
    expect(list.map((c) => c.source)).toEqual(['lan', 'zerotier', 'tailscale', 'local']);
  });

  it('显式地址排第一，且**仍然是候选之一**（不再是唯一来源）', () => {
    const list = buildRelayCandidates({ explicit: 'http://100.125.4.119:8900' });
    expect(list[0]?.url).toBe('http://100.125.4.119:8900');
    expect(list[0]?.source).toBe('explicit');
    // 关键：显式地址之外还留着备用路 —— 这是"不怕某条链路断"的落点
    expect(list.length).toBeGreaterThan(1);
    // 与 tailscale 候选去重，只留一次
    expect(list.filter((c) => c.url === 'http://100.125.4.119:8900')).toHaveLength(1);
  });

  it('last-good 排在显式之后、静态候选之前（"秒回"的关键）', () => {
    const list = buildRelayCandidates({ lastGood: 'http://10.239.5.174:8900' });
    expect(list[0]?.url).toBe('http://10.239.5.174:8900');
    expect(list[0]?.label).toContain('上次成功');
    expect(list.filter((c) => c.url === 'http://10.239.5.174:8900')).toHaveLength(1);
  });

  it('动态候选（SSH 转发/远程主机）追加在最后', () => {
    const extra: RelayCandidate[] = [
      { url: 'http://192.168.5.5:8900', source: 'dynamic', label: '动态' },
    ];
    const list = buildRelayCandidates({ extra });
    expect(list[list.length - 1]?.url).toBe('http://192.168.5.5:8900');
  });

  it('环境变量：无 + 号 = 替换，有 + 号 = 前置追加', () => {
    expect(parseRelayCandidateEnv('http://a:8900,http://b:8900')?.replace).toHaveLength(2);
    expect(parseRelayCandidateEnv('+http://a:8900')?.prepend).toHaveLength(1);
    expect(parseRelayCandidateEnv('  ')).toBeNull();
    expect(parseRelayCandidateEnv('junk,http://ok:8900')?.replace).toHaveLength(1);
    const replaced = buildRelayCandidates({ envRaw: 'http://only:8900' });
    expect(replaced.map((c) => c.url)).toEqual(['http://only:8900']);
    const prepended = buildRelayCandidates({ envRaw: '+http://first:8900' });
    expect(prepended[0]?.url).toBe('http://first:8900');
    expect(prepended[1]?.url).toBe(XIANGWO_RELAY_DEFAULT_CANDIDATE_URLS[0]);
  });

  it('normalizeBaseUrl / dedupeCandidates / classifyCandidateUrl', () => {
    expect(normalizeBaseUrl('  http://a:8900///  ')).toBe('http://a:8900');
    expect(
      dedupeCandidates([
        { url: 'http://a:8900', source: 'lan', label: 'a' },
        { url: 'http://a:8900/', source: 'zerotier', label: 'dup' },
        { url: '  ', source: 'custom', label: 'empty' },
      ])
    ).toHaveLength(1);
    expect(classifyCandidateUrl('http://192.168.2.10:8900').source).toBe('lan');
    expect(classifyCandidateUrl('http://weird:8900').source).toBe('custom');
  });
});

// ── 真 socket 探针 ──────────────────────────────────────────────────────────

describe('[XG-CUSTOM] 探针（真 socket）', () => {
  let server: Server | null = null;
  const closeServer = (): void => {
    server?.close();
    server = null;
  };
  afterEach(closeServer);

  it('活的 8900 → ok=true + 拿到 hostname；黑洞地址 → ok=false 且 <2s 返回', async () => {
    server = createServer((req, res) => {
      if (req.url === '/xg/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, hostname: 'xgqlover-PC', platform: 'Linux' }));
        return;
      }
      res.writeHead(404);
      res.end('nope');
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const alive: RelayCandidate = {
      url: `http://127.0.0.1:${String(port)}`,
      source: 'local',
      label: '测试服务器',
    };

    const good = await probeRelayCandidate(alive, { localHostname: 'someone-else' });
    expect(good.ok).toBe(true);
    expect(good.status).toBe(200);
    expect(good.hostname).toBe('xgqlover-PC');
    expect(good.isSelf).toBe(false);
    expect(good.ms).toBeLessThan(2000);

    // 同一台服务器，但"本机主机名就是它" → 判定为自我
    const self = await probeRelayCandidate(alive, { localHostname: 'xgqlover-PC' });
    expect(self.isSelf).toBe(true);

    // 一个确定没人监听的端口 → connection refused，快速失败
    const deadPort = await freePort();
    const started = Date.now();
    const dead = await probeRelayCandidate(
      { url: `http://127.0.0.1:${String(deadPort)}`, source: 'custom', label: '黑洞' },
      { timeoutMs: 1500 }
    );
    expect(dead.ok).toBe(false);
    expect(dead.status).toBe(-1);
    expect(dead.error).not.toBe('');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('4xx 也算"这条路活着"（8900 在监听，只是拒了）', async () => {
    server = createServer((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '来源不在允许网段内' }));
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const health = await probeRelayCandidate({
      url: `http://127.0.0.1:${String(port)}`,
      source: 'custom',
      label: '403 服务器',
    });
    expect(health.ok).toBe(true);
    expect(health.status).toBe(403);
    expect(health.hostname).toBe(''); // 不是 whoami 应答 → "不知道"，按"不是 self"处理
    expect(health.isSelf).toBe(false);
  });
});

// ── 自动切换 ────────────────────────────────────────────────────────────────

/** 假探针：给一张 url → 是否可达 的表；表里没有 = 黑洞（不抛，按超时/不可达处理） */
function fakeProbe(
  table: Record<string, { ok: boolean; hostname?: string; status?: number; ms?: number }>,
  calls: string[] = []
) {
  return async (candidate: RelayCandidate): Promise<RelayCandidateHealth> => {
    calls.push(candidate.url);
    const hit = table[candidate.url];
    if (hit === undefined) {
      return {
        url: candidate.url,
        ok: false,
        status: -1,
        hostname: '',
        isSelf: false,
        ms: 1500,
        error: '超时 >1500ms',
      };
    }
    return {
      url: candidate.url,
      ok: hit.ok,
      status: hit.status ?? 200,
      hostname: hit.hostname ?? 'xgqlover-PC',
      isSelf: false,
      ms: hit.ms ?? 3,
      error: hit.ok ? '' : '连接失败',
    };
  };
}

function tempStateFile(): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xg-relay-cand-'));
  return { file: join(dir, 'lastgood.json'), dir };
}

describe('[XG-CUSTOM] 多候选自动切换', () => {
  it('第一条路断了 → 自动切到下一条并成功（核心证据）', async () => {
    const { file, dir } = tempStateFile();
    const probes: string[] = [];
    const logs: string[] = [];
    const selector = new RelayCandidateSelector({
      log: (m) => logs.push(m),
      stateFile: file,
      probe: fakeProbe(
        {
          'http://10.239.5.174:8900': { ok: true, ms: 4 }, // ZeroTier 活着
        },
        probes
      ),
    });
    // 直连网线（优先级最高）在表里没有 → 黑洞
    const chosen = await selector.resolve();
    expect(chosen).toBe('http://10.239.5.174:8900');
    // 证明"先试了网线，再试了 ZeroTier"——这就是自动切换
    expect(probes).toEqual(['http://192.168.2.10:8900', 'http://10.239.5.174:8900']);
    expect(logs.some((m) => m.includes('192.168.2.10') && m.includes('不通'))).toBe(true);
    expect(logs.some((m) => m.includes('当前用 ZeroTier'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('全部不通 → 返回 null（交给调用方退避），且不抛', async () => {
    const { file, dir } = tempStateFile();
    const selector = new RelayCandidateSelector({
      stateFile: file,
      probe: fakeProbe({}),
      log: () => undefined,
    });
    await expect(selector.resolve()).resolves.toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('探针自己抛异常 → 当作不可用，继续试下一个（永不把功能带崩）', async () => {
    const { file, dir } = tempStateFile();
    const selector = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: async (candidate) => {
        if (candidate.url.includes('192.168.2.10')) throw new Error('boom');
        return {
          url: candidate.url,
          ok: true,
          status: 200,
          hostname: 'xgqlover-PC',
          isSelf: false,
          ms: 1,
          error: '',
        };
      },
    });
    await expect(selector.resolve()).resolves.toBe('http://10.239.5.174:8900');
    rmSync(dir, { recursive: true, force: true });
  });

  it('记住上次成功的那个：换一个选择器实例（≈进程重启）先试它', async () => {
    const { file, dir } = tempStateFile();
    const first = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: fakeProbe({ 'http://100.125.4.119:8900': { ok: true } }),
    });
    await expect(first.resolve()).resolves.toBe('http://100.125.4.119:8900');
    expect(JSON.parse(readFileSync(file, 'utf8')).url).toBe('http://100.125.4.119:8900');

    // 新实例（模拟 Windows 上 emdash 重启）：没有内存状态，只有落盘的记忆
    const probes: string[] = [];
    const second = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: fakeProbe({ 'http://100.125.4.119:8900': { ok: true } }, probes),
    });
    await expect(second.resolve()).resolves.toBe('http://100.125.4.119:8900');
    // 只探了一次，而且探的**就是**上次成功那条 —— 不是从头按静态顺序摸
    expect(probes).toEqual(['http://100.125.4.119:8900']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('落盘文件坏了/不存在都不影响（缓存只是加速）', async () => {
    const { file, dir } = tempStateFile();
    writeFileSync(file, 'not json at all', 'utf8');
    const selector = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: fakeProbe({ 'http://192.168.2.10:8900': { ok: true } }),
    });
    await expect(selector.resolve()).resolves.toBe('http://192.168.2.10:8900');
    rmSync(dir, { recursive: true, force: true });
  });

  it('recheckMs 内零探测（复用缓存）；到期后复检并切走死掉的路', async () => {
    const { file, dir } = tempStateFile();
    let now = 1_000_000;
    const probes: string[] = [];
    const table: Record<string, { ok: boolean }> = { 'http://192.168.2.10:8900': { ok: true } };
    const selector = new RelayCandidateSelector({
      stateFile: file,
      recheckMs: 300_000,
      now: () => now,
      log: () => undefined,
      probe: fakeProbe(table as never, probes),
    });
    expect(await selector.resolve()).toBe('http://192.168.2.10:8900');
    expect(probes).toHaveLength(1);

    // 4 分钟后：还在缓存期内 → 一次都不探
    now += 240_000;
    expect(await selector.resolve()).toBe('http://192.168.2.10:8900');
    expect(probes).toHaveLength(1);

    // 网线断了；6 分钟后复检 → 换成 ZeroTier
    table['http://192.168.2.10:8900'] = { ok: false };
    table['http://10.239.5.174:8900'] = { ok: true };
    now += 360_000;
    expect(await selector.resolve()).toBe('http://10.239.5.174:8900');
    expect(selector.state().switches).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('relay 连续报失败到阈值 → 冷却该路并换路（黑洞 TCP 也能切走）', async () => {
    const { file, dir } = tempStateFile();
    const probes: string[] = [];
    const selector = new RelayCandidateSelector({
      stateFile: file,
      failuresBeforeSwitch: 3,
      log: () => undefined,
      probe: fakeProbe(
        {
          'http://192.168.2.10:8900': { ok: true },
          'http://10.239.5.174:8900': { ok: true },
        },
        probes
      ),
    });
    expect(await selector.resolve()).toBe('http://192.168.2.10:8900');

    expect(selector.noteFailure('http://192.168.2.10:8900')).toBe(false);
    expect(selector.noteFailure('http://192.168.2.10:8900')).toBe(false);
    expect(selector.noteFailure('http://192.168.2.10:8900')).toBe(true); // 第 3 次 → 判定换路

    probes.length = 0;
    expect(await selector.resolve()).toBe('http://10.239.5.174:8900');
    // 网络那条被冷却 → **这次没再白试一次**，直接命中 ZeroTier
    expect(probes).toEqual(['http://10.239.5.174:8900']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('候选全是"本机自己" → 交回回环地址，让 relay 的避让判定干净停用（家里 Linux 回归保护）', async () => {
    const { file, dir } = tempStateFile();
    const selector = new RelayCandidateSelector({
      stateFile: file,
      localHostname: 'xgqlover-PC',
      log: () => undefined,
      probe: async (candidate) => ({
        url: candidate.url,
        ok: true,
        status: 200,
        hostname: 'xgqlover-PC', // 四个候选都报"我就是你"
        isSelf: true,
        ms: 1,
        error: '',
      }),
    });
    // 回环优先（relay 的 isLoopbackAgentBase 只对"回环+8900"做避让判定）
    expect(await selector.resolve()).toBe('http://127.0.0.1:8900');
    rmSync(dir, { recursive: true, force: true });
  });

  it('有非自机候选时，自机候选被跳过（家里 Linux 不会经网线拨自己）', async () => {
    const { file, dir } = tempStateFile();
    const probes: string[] = [];
    const selector = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: async (candidate) => {
        probes.push(candidate.url);
        // 192.168.2.10 / 10.239.5.174 / 100.125.4.119 / 127.0.0.1 都"是本机"
        const isSelf = candidate.url !== 'http://remote-linux:8900';
        return {
          url: candidate.url,
          ok: true,
          status: 200,
          hostname: isSelf ? 'xgqlover-PC' : 'win-box',
          isSelf,
          ms: 1,
          error: '',
        };
      },
      extraCandidates: async () => [
        { url: 'http://remote-linux:8900', source: 'dynamic', label: '动态远端' },
      ],
    });
    expect(await selector.resolve()).toBe('http://remote-linux:8900');
    expect(probes).toHaveLength(5); // 四个静态都试过（并认出是自己），最后才是动态
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('[XG-CUSTOM] 选择器状态上报（日志/排查）', () => {
  it('state() 能说清"现在用哪条路 + 切换了几次 + 刚探过什么"', async () => {
    const { file, dir } = tempStateFile();
    const selector = new RelayCandidateSelector({
      stateFile: file,
      log: () => undefined,
      probe: fakeProbe({ 'http://10.239.5.174:8900': { ok: true, status: 200 } }),
    });
    await selector.resolve();
    const state = selector.state();
    expect(state.current).toBe('http://10.239.5.174:8900');
    expect(state.currentLabel).toBe('ZeroTier');
    expect(state.confirmedAt).toBeGreaterThan(0);
    expect(state.lastProbes.length).toBeGreaterThanOrEqual(2);
    expect(state.stateFile).toBe(file);
    rmSync(dir, { recursive: true, force: true });
  });

  it('并发 resolve() 只探一轮（在飞去重）', async () => {
    const { file, dir } = tempStateFile();
    const probe = vi.fn(fakeProbe({ 'http://192.168.2.10:8900': { ok: true } }));
    const selector = new RelayCandidateSelector({ stateFile: file, log: () => undefined, probe });
    const [a, b, c] = await Promise.all([selector.resolve(), selector.resolve(), selector.resolve()]);
    expect([a, b, c]).toEqual([
      'http://192.168.2.10:8900',
      'http://192.168.2.10:8900',
      'http://192.168.2.10:8900',
    ]);
    expect(probe).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

/** 找一个确定没人监听的端口（listen 0 → 拿端口 → 立刻关） */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}
