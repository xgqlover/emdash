// [XG-CUSTOM 2026-10-12] 「球里点链接 → emdash 内嵌浏览器开页」的**回执登记处**（主进程侧）。
//
// ── 为什么需要它 ──────────────────────────────────────────────────────────────
// 开页请求是**主进程 → 主窗口渲染进程**的一条广播（`open-in-embedded-browser`，fire-and-forget）：
// 主进程发出去就完事，**拿不到渲染进程那边的结果**。于是球里点一下链接，无论成没成，
// 球收到的都是 `{ok:true}`（`xiangwo-orb-api.ts` 的 `host.openEmbeddedBrowser` 老实现），
// 失败**完全静默** —— 用户点了没反应，日志里也没有一行。
//
// 这里就是补上那一半：orb-api 发广播前先**登记一个 requestId**，把 requestId 随事件带下去；
// 主窗口渲染进程干完活（`openEmbeddedBrowserTab` 返回 `{ok, reason}`）后，经 Wire 把结果送回来
// （browser 契约的 `reportEmbeddedBrowserOpenResult` → `main/host/browser/controller.ts`），
// 由本模块把等待中的 Promise 落地 ⇒ 球那边就能拿到真实的 `{ok:false, reason}` 并显示回执。
//
// ── 三条纪律 ──────────────────────────────────────────────────────────────────
//   ① **必须有超时**：事件流没有订阅者时事件会被静默丢掉（渲染进程还没挂上订阅/崩了），
//      不设超时的话球的 `orbApi` 调用就永远不返回 —— 那比静默更糟（连点击都像卡死）。
//   ② **只认登记过的 requestId**：没登记过的（老调用方 agent 9223 桥 / 反向通道，它们不带
//      requestId）一律不进这里 ⇒ 老路径零回归，行为与改动前逐字节一致。
//   ③ **不抛**：回执是"尽力而为"的旁路，任何异常都不能影响开页本身。

/** 开页结果：成功 / 带**可判别原因**的失败（原因码由渲染进程给，原样带回球侧）。 */
export type EmbeddedBrowserOpenOutcome = { ok: true } | { ok: false; reason: string };

/**
 * 等回执的上限（毫秒）。超时只说明"没等到渲染进程回话"，**不代表页没开**，所以原因码
 * 单独叫 `timeout`（球侧文案会如实说"没确认开成"，不假装失败）。
 * 4s：正常路径是同步的（渲染进程拿到事件立刻执行、立刻回报），只有"没人接"才会走到这里。
 */
export const EMBEDDED_BROWSER_OPEN_ACK_TIMEOUT_MS = 4000;

type Pending = {
  resolve: (outcome: EmbeddedBrowserOpenOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

let sequence = 0;

/** 造一个进程内唯一的 requestId（只用于这一次开页的一问一答）。 */
export function nextEmbeddedBrowserOpenRequestId(): string {
  sequence += 1;
  return `open-${Date.now().toString(36)}-${sequence}`;
}

/**
 * 登记一次开页，返回"等回执"的 Promise。**调用方（orb-api）必须在发广播之前调它** ——
 * 反过来的话渲染进程的回执可能先到、而这里还没有登记，回执就被丢掉了。
 */
export function waitEmbeddedBrowserOpenResult(
  requestId: string,
  timeoutMs: number = EMBEDDED_BROWSER_OPEN_ACK_TIMEOUT_MS
): Promise<EmbeddedBrowserOpenOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    // Node/Electron 主进程里 timer 会**把进程钉住**不让退出；回执是旁路，不该拖住退出。
    timer.unref();
    pending.set(requestId, { resolve, timer });
  });
}

/**
 * 落一次回执（渲染进程经 Wire 送来）。
 * @returns 是否命中了登记中的请求（false = 已超时/重复/伪造的 id，**调用方按 no-op 处理**）
 */
export function settleEmbeddedBrowserOpenResult(
  requestId: string,
  outcome: { ok: boolean; reason?: string }
): boolean {
  const entry = pending.get(requestId);
  if (entry === undefined) return false;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.resolve(
    outcome.ok === true
      ? { ok: true }
      : { ok: false, reason: typeof outcome.reason === 'string' ? outcome.reason : 'failed' }
  );
  return true;
}

/** 当前在等待回执的请求数（自检/单测用；生产不消费）。 */
export function pendingEmbeddedBrowserOpenCount(): number {
  return pending.size;
}
