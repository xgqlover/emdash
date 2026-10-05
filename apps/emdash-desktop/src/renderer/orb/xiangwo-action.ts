// [XG-CUSTOM 2026-10-05] **球的「指挥主界面」动作块**（`[XG-ACTION]{…}[/XG-ACTION]`）解析 + 执行。
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
// 回归测试见 ./xiangwo-action.test.ts
export const XIANGWO_ACTION_RE = /```xiangwo-action\s*\n([\s\S]*?)```/g;

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
 * 执行一个动作：交给调用方注入的 `run`（球里就是 `orbApi('host.runCommand', …)`）。
 * **不抛**：任何异常都收敛成 `{ok:false, reason:'failed'}`，如实回报。
 */
export async function runXiangwoAction(
  action: XiangwoAction,
  run: (method: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<XiangwoActionResult> {
  try {
    const raw = await run('host.runCommand', {
      id: action.id,
      ...(action.args === undefined ? {} : { args: action.args }),
    });
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
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) };
  }
}

/** 失败原因 → 给用户看的一句话（不粉饰）。 */
export function actionFailureText(action: XiangwoAction, result: XiangwoActionResult): string {
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
