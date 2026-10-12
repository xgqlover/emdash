// [XG-CUSTOM 2026-10-12] 「开页回执登记处」单测 —— 球里点链接为什么能拿到 `{ok:false, reason}`。
//
// 三条判据（对应 embedded-browser-open-ack.ts 的文件头纪律）：
//   ① 回执到了 → 等着的 Promise 落地成渲染进程给的那个结果（成功/失败都带原样 reason）；
//   ② 没登记过的 requestId（老调用方 agent 9223 桥不带 requestId）→ 一律 no-op，零回归；
//   ③ 没人回话 → **有超时**（不许让球的点击永远等下去），原因码是 `timeout`。
import { describe, expect, it } from 'vitest';
import {
  nextEmbeddedBrowserOpenRequestId,
  pendingEmbeddedBrowserOpenCount,
  settleEmbeddedBrowserOpenResult,
  waitEmbeddedBrowserOpenResult,
} from './embedded-browser-open-ack';

describe('[XG-CUSTOM] 开页回执登记处（球点链接 → 主窗渲染进程 → 回执）', () => {
  it('★ 成功：渲染进程回 {ok:true} → Promise 落地 {ok:true}', async () => {
    const id = nextEmbeddedBrowserOpenRequestId();
    const waiting = waitEmbeddedBrowserOpenResult(id);
    expect(pendingEmbeddedBrowserOpenCount()).toBe(1);
    expect(settleEmbeddedBrowserOpenResult(id, { ok: true })).toBe(true);
    await expect(waiting).resolves.toEqual({ ok: true });
    expect(pendingEmbeddedBrowserOpenCount()).toBe(0);
  });

  it('★ 失败：reason 原样带出（球侧要靠它说人话）', async () => {
    const id = nextEmbeddedBrowserOpenRequestId();
    const waiting = waitEmbeddedBrowserOpenResult(id);
    settleEmbeddedBrowserOpenResult(id, { ok: false, reason: 'no-task' });
    await expect(waiting).resolves.toEqual({ ok: false, reason: 'no-task' });
  });

  it('失败但没给 reason → 兜底 `failed`（不出现 reason: undefined）', async () => {
    const id = nextEmbeddedBrowserOpenRequestId();
    const waiting = waitEmbeddedBrowserOpenResult(id);
    settleEmbeddedBrowserOpenResult(id, { ok: false });
    await expect(waiting).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('★ 没登记过的 id → no-op（老调用方零回归，且不许把别人的等待打歪）', async () => {
    expect(settleEmbeddedBrowserOpenResult('open-不存在', { ok: true })).toBe(false);
    const id = nextEmbeddedBrowserOpenRequestId();
    const waiting = waitEmbeddedBrowserOpenResult(id);
    expect(settleEmbeddedBrowserOpenResult('open-另一个', { ok: false, reason: 'x' })).toBe(false);
    expect(pendingEmbeddedBrowserOpenCount()).toBe(1);
    settleEmbeddedBrowserOpenResult(id, { ok: true });
    await expect(waiting).resolves.toEqual({ ok: true });
  });

  it('同一个 id 只认第一次回执（重复回执不能覆盖已落地的结果）', async () => {
    const id = nextEmbeddedBrowserOpenRequestId();
    const waiting = waitEmbeddedBrowserOpenResult(id);
    expect(settleEmbeddedBrowserOpenResult(id, { ok: true })).toBe(true);
    expect(settleEmbeddedBrowserOpenResult(id, { ok: false, reason: 'late' })).toBe(false);
    await expect(waiting).resolves.toEqual({ ok: true });
  });

  it('★ 没人回话 → 超时落地 {ok:false, reason:"timeout"}（不把点击卡死）', async () => {
    const id = nextEmbeddedBrowserOpenRequestId();
    await expect(waitEmbeddedBrowserOpenResult(id, 10)).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    });
    // 超时后登记要清掉，否则表会越涨越大
    expect(pendingEmbeddedBrowserOpenCount()).toBe(0);
    // 迟到的回执不能再命中（已超时）
    expect(settleEmbeddedBrowserOpenResult(id, { ok: true })).toBe(false);
  });
});
