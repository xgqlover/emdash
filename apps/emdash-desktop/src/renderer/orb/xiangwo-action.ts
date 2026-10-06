// [XG-CUSTOM] 2026-10-05 —— **球的「指挥主界面」动作块**（`[XG-ACTION]{…}[/XG-ACTION]`）解析 + 执行。
//
// 用户要求：「球要用到的网页，跟别的功能主界面要同步支持」。
// 事实源 = 主界面命令目录的子集（`main/host/xiangwo-host-commands.ts` 白名单）；
// 本文件是**球侧的一段**：把 agent 回复里的动作块解析出来 → 调 `orbApi('host.runCommand')`。
//
// 三条约定（与审批卡/提问卡同族）：
//   ① **声明式**：只传命令 id + 参数，**不传代码**；
//   ② **白名单在服务端**（主进程再查一次表）—— 球侧只做格式校验，**不自己判合法性**（避免两边漂移）；
//   ③ **回执如实**：主进程回 `{ok:false, reason}` 时**照原样说出来**（unknown-command / needs-approval /
//      unavailable / failed），**不假装成功**。
//
// [XG-CUSTOM] 2026-10-06 **唯一的例外：直连方法表**（见下 `DIRECT_ACTIONS`）——
//   用户要「用文字指挥 emdash 开网页」，但白名单里 8 条 UI 命令**没有一条能开网页**，
//   而 `host.openEmbeddedBrowser` **本就是独立、已经接好的 orbApi 方法**（球里点图片卡片走的就是它，
//   见 ./xiangwo-images.ts / main/host/xiangwo-orb-api.ts）。所以「开网页」不走 `host.runCommand`，
//   直接命中那张表 → `run('host.openEmbeddedBrowser', …)`。
//   🔴 表里**只有这一个 id**：不动白名单、不动主进程注入，也**绝不**把 `host.*` 通配放开。
//
// 回归测试见 ./xiangwo-action.test.ts
export const XIANGWO_ACTION_RE = /```xiangwo-action\s*\n([\s\S]*?)```/g;

/** 直连方法表里唯一的一条：在 emdash 内嵌浏览器里开网页（id = orbApi 的方法名）。 */
// [XG-CUSTOM] 2026-10-06 开网页这条通道的 id（与主进程 `host.openEmbeddedBrowser` 同名）。
export const XIANGWO_OPEN_EMBEDDED_BROWSER_ID = 'host.openEmbeddedBrowser';

/** 球的「直连通道」动作 id → orbApi 方法名。**只登记已通且可安全直连的方法**。 */
// [XG-CUSTOM] 2026-10-06 只放 `host.openEmbeddedBrowser` 一个；条目形状是 `动作id → 方法名`，
//   为的是**动作 id 可以不同于方法名**（将来若要包一层别名，也不用改执行逻辑）。
export const XIANGWO_DIRECT_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  [XIANGWO_OPEN_EMBEDDED_BROWSER_ID]: XIANGWO_OPEN_EMBEDDED_BROWSER_ID,
});

/** 只认 http/https（白名单式判断：其余一律拒，**不**退化成系统浏览器）。 */
// [XG-CUSTOM] 2026-10-06 用 `startsWith` 而不是正则，避免 `javascript:` / `file:` / `data:` 之类漏网。
function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 把动作参数整理成 `host.openEmbeddedBrowser` 要的形状。
 *
 * [XG-CUSTOM] 2026-10-06 三条（与主进程同口径，球侧先自查一遍只为**早失败 + 说人话**）：
 *   ① url 必填且必须是 http(s) —— 空/非法 → `null`（调用方回 `bad-url`，**不发起调用**）；
 *   ② bot 选填，只有非空字符串才透传（空串等于没指定，与 ./xiangwo-images.ts 一致）；
 *   ③ payload 里只放这两个键 —— 多余参数**不转发**（少一个泄面）。
 */
function buildOpenEmbeddedBrowserPayload(args: unknown): { url: string; bot?: string } | null {
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!isHttpUrl(url)) return null;
  const bot = typeof record.bot === 'string' ? record.bot.trim() : '';
  return bot === '' ? { url } : { url, bot };
}

export interface XiangwoAction {
  /** 主界面命令 id（如 `app.settings`） */
  readonly id: string;
  /** 可选参数（结构化克隆友好） */
  readonly args?: unknown;
}

export interface XiangwoActionResult {
  readonly ok: boolean;
  /** 失败原因（主进程原样回的：unknown-command / needs-approval / unavailable / failed） */
  readonly reason?: string;
  readonly message?: string;
}

/** 从回复正文里解析动作块（可能多个）。解析失败/形状不对 → 跳过该块（不抛）。 */
export function parseXiangwoActionBlock(text: string): XiangwoAction[] {
  const out: XiangwoAction[] = [];
  const source = text ?? '';
  for (const match of source.matchAll(XIANGWO_ACTION_RE)) {
    const body = (match[1] ?? '').trim();
    if (body === '') continue;
    try {
      const parsed: unknown = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        if (id === '') continue;
        out.push(record.args === undefined ? { id } : { id, args: record.args });
      }
    } catch {
      // 坏 JSON 静默跳过：宁可少做一个动作，也不要因为一段坏块打断整条回复
    }
  }
  return out;
}

/** 去掉动作块（给球渲染正文用，免得把 JSON 也显示出来）。 */
export function stripXiangwoActionBlocks(text: string): string {
  return (text ?? '').replace(XIANGWO_ACTION_RE, '').trim();
}

/**
 * 主进程回执 → 球侧结果：**照原样**（`{ok:false,reason,message}` 不粉饰）。
 * [XG-CUSTOM] 2026-10-06 从 `runXiangwoAction` 里提出来，直连/白名单两条路共用同一套判定。
 */
function toActionResult(raw: unknown): XiangwoActionResult {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    if (record.ok === true) return { ok: true };
    return {
      ok: false,
      reason: typeof record.reason === 'string' ? record.reason : 'failed',
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    };
  }
  return { ok: false, reason: 'failed' };
}

/**
 * 执行一个动作：交给调用方注入的 `run`（球里就是 `orbApi('host.runCommand', …)`）。
 * **不抛**：任何异常都收敛成 `{ok:false, reason:'failed'}`，如实回报。
 *
 * [XG-CUSTOM] 2026-10-06 命中直连表（当前只有「开网页」）→ 直接 `run('host.openEmbeddedBrowser', …)`，
 * **不走** `host.runCommand`（白名单里没这条；走了必然回 unknown-command）。其余动作**原路不变**。
 */
export async function runXiangwoAction(
  action: XiangwoAction,
  run: (method: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<XiangwoActionResult> {
  try {
    // [XG-CUSTOM] 2026-10-06 直连：只此一条，且**只**开网页；非法 url 当场拒（一次调用都不发）。
    const directMethod = XIANGWO_DIRECT_ACTIONS[action.id];
    if (directMethod === XIANGWO_OPEN_EMBEDDED_BROWSER_ID) {
      const payload = buildOpenEmbeddedBrowserPayload(action.args);
      if (payload === null) return { ok: false, reason: 'bad-url' };
      return toActionResult(await run(directMethod, payload));
    }
    const raw = await run('host.runCommand', {
      id: action.id,
      ...(action.args === undefined ? {} : { args: action.args }),
    });
    return toActionResult(raw);
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) };
  }
}

/** 失败原因 → 给用户看的一句话（不粉饰）。 */
export function actionFailureText(action: XiangwoAction, result: XiangwoActionResult): string {
  // [XG-CUSTOM] 2026-10-06 开网页这条路的两种失败要单独说清（别的动作走原来的话术，零回归）。
  if (action.id === XIANGWO_OPEN_EMBEDDED_BROWSER_ID) {
    if (result.reason === 'unavailable') return '球开网页这条通道没接上（主进程没注入），我没开。';
    if (result.reason === 'bad-url')
      return '这个地址不是 http(s) 开头（或者为空），我没开（也不会替你去开系统浏览器）。';
  }
  switch (result.reason) {
    case 'needs-approval':
      return `「${action.id}」属于写操作，需要你确认后我才能执行。`;
    case 'unknown-command':
      return `「${action.id}」不在可执行清单里，我没做（不会乱碰界面）。`;
    case 'unavailable':
      return `这条通道还没接上（主界面执行器没就绪），「${action.id}」没执行。`;
    default:
      return `「${action.id}」执行失败${result.message ? `：${result.message}` : ''}。`;
  }
}
