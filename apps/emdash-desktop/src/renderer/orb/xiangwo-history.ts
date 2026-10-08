// [XG-CUSTOM 2026-10-04] 侧边枝历史「拉回」：球重开/换机器后不丢对话。
//
// 背景（见 sidebar-agent/OPS.md §2026-10-04）：
//   后端一直有 `GET /sidebar/history?bot=&session_id=`（agent.py:9448 → _sidebar_history_json），
//   并且侧边枝一直在落盘（_suagent_log_turn source="sidebar"），但**前端从来没调用过它** ——
//   球的会话只活在 localStorage，清缓存/换机器就没了，表现为「侧边也没有重新记忆」。
//
// 本模块只做纯逻辑（拼 URL + 规范化返回 + 取数），不碰 DOM / electron，可被 vitest 直接断言；
// 「什么时候拉、拉到之后怎么装进会话」这类接线留在 orb.js。
//
// ⚠️ 边界（**2026-10-08 已关闭**）：默认 bot（`#bot` 的 value 为空串 =「项我」）此前后端**没有侧边枝** ——
//   `_suagent_log_turn` 取 `_sidebar_branch_ids.get('')` 取不到直接 return，
//   而 `_sidebar_branch_ids` 只为 `sr.list_all_ids()` 建 ⇒ 对它拉回来必然是空的。
//   [XG-CUSTOM 2026-10-08] 后端现在**给默认 bot 也建侧边枝**（`agent.py` 分支注册里显式加 `""`，
//   发现规则从 `and sid` 改成 `and sid is not None`），并在 `_sse_stream` 收尾处把**无 @bot 的球侧回合**
//   落进那条枝（`_orb_log_default_sidebar_turn`）⇒ 默认「项我」的球侧历史现在也能从 Pi 树拉回。
//   ⚠️ 只有**新**回合会进树；此前只存在 localStorage 的老对话不会回填。

/** 侧边枝历史端点（与 agent.py 的 do_GET 对齐） */
export const SIDEBAR_HISTORY_PATH = '/sidebar/history';
/** 单条 content 长度上限（后端已经 [:500]，这里再兜一层，防后端改版灌爆 localStorage） */
export const SIDEBAR_HISTORY_TEXT_MAX = 2000;
/** 最多保留多少条（后端 limit 默认 50；这里只做兜底，不主动放大） */
export const SIDEBAR_HISTORY_MAX = 200;

export type SidebarHistoryMessage = {
  role: string;
  text: string;
  timestamp: string;
};

export type SidebarHistory = {
  messages: SidebarHistoryMessage[];
  title: string;
};

export type FetchSidebarHistoryOptions = {
  url: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * 拼 `/sidebar/history` 的绝对地址。
 *
 * `agentBase` 来自主进程解析的 8900 基址（隧道 → 主机直连 → 本机，见 CUSTOMIZATIONS.md 第 15 条），
 * 为空（还没解析出来）时返回空串 —— 调用方据此跳过本次拉取，绝不拼出半个地址去发请求。
 *
 * `bot` 一律带上（空串 = 默认「项我」，后端返回空列表）；`sessionId` 为空则不带，
 * 语义 = 「这个 bot 的整条侧边枝」——正是换机器时要恢复的东西。
 */
export function buildSidebarHistoryUrl(agentBase: string, botId: string, sessionId = ''): string {
  const base = typeof agentBase === 'string' ? agentBase.trim().replace(/\/+$/, '') : '';
  if (base === '') return '';
  const query = new URLSearchParams();
  query.set('bot', typeof botId === 'string' ? botId : '');
  const session = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (session !== '') query.set('session_id', session);
  return `${base}${SIDEBAR_HISTORY_PATH}?${query.toString()}`;
}

/**
 * 规范化后端返回：形状不对的行、空内容一律丢弃。
 * **永不抛** —— 拉历史是锦上添花，绝不能因此让球崩或挡住聊天。
 */
export function normalizeSidebarHistory(raw: unknown): SidebarHistory {
  const root = asRecord(raw);
  const title = typeof root.title === 'string' ? root.title.trim() : '';
  const rows = Array.isArray(root.messages) ? root.messages : [];
  const messages: SidebarHistoryMessage[] = [];
  for (const row of rows) {
    if (messages.length >= SIDEBAR_HISTORY_MAX) break;
    const item = asRecord(row);
    const text = typeof item.content === 'string' ? item.content : '';
    if (text.trim() === '') continue;
    const role = typeof item.role === 'string' && item.role !== '' ? item.role : 'assistant';
    const timestamp = typeof item.timestamp === 'string' ? item.timestamp : '';
    messages.push({ role, text: text.slice(0, SIDEBAR_HISTORY_TEXT_MAX), timestamp });
  }
  return { messages, title };
}

/** 后端历史 → 球的会话消息（球的渲染只认 `{ role, text }`；timestamp 不入会话） */
export function historyToMessages(history: SidebarHistory): Array<{ role: string; text: string }> {
  return history.messages.map((message) => ({ role: message.role, text: message.text }));
}

/**
 * 拉一次侧边枝历史。任何失败（网络不通 / 非 2xx / JSON 坏 / abort）都返回 `undefined`，
 * 由调用方决定「什么都不做」——不抛、不提示、不影响正在进行的聊天。
 */
export async function fetchSidebarHistory(
  options: FetchSidebarHistoryOptions
): Promise<SidebarHistory | undefined> {
  if (options.url === '') return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) return undefined;
    const parsed: unknown = await response.json();
    return normalizeSidebarHistory(parsed);
  } catch {
    return undefined;
  }
}
