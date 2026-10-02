// [XG-CUSTOM 2026-10-02] 环境变量开关单测：老 exe（已发布、只有旧判据）的逃生路径。
//
// 关键事实：`XIANGWO_BROWSER_RELAY_URL` 与"反向通道"是同一次提交引入的，所以**任何带反向
// 通道的 exe 都认这个变量**；显式给了它就等于 skipLocalAgentBase=false → 无条件拨，
// 老 exe 不用重装就能解开"回环 8900 被误停用"。
//
// ⚠️ 踩坑记录：`XIANGWO_BROWSER_RELAY_URL` 以 `_URL` 结尾，undici 会把它当 NODE 选项式的
// 环境变量 —— 在单测里 set 了它之后，**连 vitest 自己的 IPC/fetch 都会挂住**，forks worker
// 退不掉（表现为 "Timeout terminating forks worker"）。所以本文件**一个 `*_URL` 变量都不 set**：
//   · "工厂优先用显式 URL" 这条由 `wiring.ts` 的 explicitTarget 路径 + 下面的 explicitTarget 用例覆盖
//   · 反正是"读 env"的纯逻辑，`relayEnabledFromEnv` / `relaySkipLocalAgentFromEnv` 直接喂值测
import { afterEach, describe, expect, it } from 'vitest';
import {
  createXiangwoBrowserRelay,
  relayEnabledFromEnv,
  relaySkipLocalAgentFromEnv,
  XiangwoBrowserRelay,
} from './xiangwo-browser-relay';

// 注意：**故意不含 `XIANGWO_BROWSER_RELAY_URL`** —— 见文件头踩坑记录，set 了它 = 毒 fetch。
const KEYS = [
  'XIANGWO_BROWSER_RELAY',
  'XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT',
  'XIANGWO_BROWSER_RELAY_WAIT',
  'XIANGWO_EMDASH_CDP_BASE',
] as const;

const saved = new Map<string, string | undefined>();
for (const key of KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** 让 relay 循环跑几拍（假 fetch 立刻返回，靠让出宏任务推进） */
async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
  }
}

/** 造一个"线上选项一样、但 fetch 不走真网络"的 relay 并跑几拍 */
async function dialOnce(resolveBaseUrl: () => Promise<string>) {
  const calls: string[] = [];
  const relay = new XiangwoBrowserRelay({
    resolveBaseUrl,
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // ⚠️ 必须先让出一个**宏任务**：relay 主循环 `while` 靠微任务就能一直转，
      // 假 fetch 若同步 resolve，`setTimeout` 永远排不上 → 死循环 → OOM。
      // （隔壁 `xiangwo-browser-relay.test.ts` 的 makeFetch 同一坑同一解）
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch,
    skipLocalAgentBase: false,
    explicitTarget: true,
    backoffStepsMs: [1],
    log: () => undefined,
  });
  relay.start();
  await tick(6);
  relay.stop();
  return { relay, calls };
}

describe('工厂函数读环境变量（老 exe 逃生路径）', () => {
  it('XIANGWO_BROWSER_RELAY=0 关掉；=1 是开（不是关）', () => {
    process.env.XIANGWO_BROWSER_RELAY = '0';
    expect(createXiangwoBrowserRelay(async () => null, () => undefined)).toBeNull();
    process.env.XIANGWO_BROWSER_RELAY = '1';
    expect(relayEnabledFromEnv(process.env.XIANGWO_BROWSER_RELAY)).toBe(true);
    expect(
      createXiangwoBrowserRelay(async () => 'http://linux:8900', () => undefined)
    ).not.toBeNull();
    delete process.env.XIANGWO_BROWSER_RELAY;
  });

  it('SKIP_LOCAL_AGENT 缺省 off，=1 才强制停用', () => {
    expect(relaySkipLocalAgentFromEnv(process.env.XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT)).toBe(
      false
    );
    process.env.XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT = '1';
    expect(relaySkipLocalAgentFromEnv(process.env.XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT)).toBe(
      true
    );
    delete process.env.XIANGWO_BROWSER_RELAY_SKIP_LOCAL_AGENT;
  });
});

// 显式地址（= 用户设了 XIANGWO_BROWSER_RELAY_URL 之后的生产选项）→ 不做身份探测，直接长轮询
describe('显式地址路径（explicitTarget）', () => {
  it('不做 /xg/whoami 探测，直接进长轮询', async () => {
    const { relay, calls } = await dialOnce(async () => 'http://127.0.0.1:8900');
    expect(relay.status().baseUrl).toBe('http://127.0.0.1:8900');
    expect(calls.some((url) => url.includes('/api/emdash-browser/poll'))).toBe(true);
    expect(calls.some((url) => url.includes('/xg/whoami'))).toBe(false);
  });
});
