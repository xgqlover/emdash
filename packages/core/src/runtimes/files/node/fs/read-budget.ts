// [XG-CUSTOM 2026-11-17] readText 并发 + 字节预算闸
//   病象：一次 ACP attach 里 files.fs.readText 被调 4,300+ 次、回 0.5~2 GB；12 MB/s 链路上要 95 秒 ⇒ 必然超时，
//         失败后每 20~25 秒再来一遍 ⇒ 自我放大。
//   只做两件最保守的事（可回退、不动调用方）：
//     ① 同时在读的 readText 不超过 MAX_INFLIGHT —— 超了直接拒，不进队列（排队正是放大的来源）；
//     ② 60 秒滑动窗口累计放出不超过 WINDOW_BYTES。
//   阈值保守：正常编辑器/搜索用不满；一旦打满，一定是有人在整仓扫。
export const TEXT_READ_HARD_LIMIT = 1024 * 1024; // 单次最多 1 MiB（配合已有的 truncated 标记）
const MAX_INFLIGHT = 8;
const WINDOW_MS = 60_000;
const WINDOW_BYTES = 64 * 1024 * 1024;

let inflight = 0;
let windowStart = Date.now();
let windowBytes = 0;

export function acquireReadTextSlot(): { ok: true } | { ok: false; reason: string } {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowBytes = 0;
  }
  if (inflight >= MAX_INFLIGHT) return { ok: false, reason: `readText inflight limit (${MAX_INFLIGHT}) reached` };
  if (windowBytes >= WINDOW_BYTES) return { ok: false, reason: `readText byte budget (${WINDOW_BYTES}B/60s) exhausted` };
  inflight += 1;
  return { ok: true };
}

export function releaseReadTextSlot(bytes: number): void {
  inflight = Math.max(0, inflight - 1);
  if (Number.isFinite(bytes) && bytes > 0) windowBytes += bytes;
}
