// [XG-CUSTOM 2026-10-12] **「球 → 主窗」单一入口**（意图 → 通道的唯一判定处）。
//
// 为什么要它（用户："mcp apps 怎么让球侧把搜到的东西灌到主窗上"）：
//   MCP Apps 里 App → 宿主的出口是**标准化的**（`ui/message` 进会话 · `ui/update-model-context` 只给模型 ·
//   `ui/open-link` 开链接）。我们球侧今天靠**私有命令**做同一件事（`xiangwo-open-url` 块、
//   `runXiangwoAction` → `bridge.orbApi('host.openEmbeddedBrowser')`、发图块），出口散在几处、
//   命名也不统一 ⇒ 将来接 MCP Apps 要改多处，而且**发出去没人接时是静默的**。
//   ⇒ 先把"出球"这件事收成这一个纯函数：**意图 → 通道**，认不出的意图**如实说不行**（不许假成功）。
//
// 与 `xiangwo-agent/xg_user_action.py` **反向对称**：那个是"用户操作 → 模型/记忆"（入），这个是"界面产出 → 会话/主窗"（出）。
export type OutboundIntent = 'open_tab' | 'show_in_conversation' | 'model_only';

/** 开内嵌浏览器这件的通道名 = 主进程 `host.openEmbeddedBrowser`（在球里由 boot 注入）。 */
export const EMBEDDED_OPEN_METHOD = 'host.openEmbeddedBrowser';

export type OutboundChannel =
  | typeof EMBEDDED_OPEN_METHOD          // 开页面（主窗 tab）
  | 'conversation.send'                  // 作为一条消息进会话（≈ MCP Apps `ui/message`）
  | 'pass-through'                       // 不是我们这一类出口 ⇒ 原样交给原有通路（零干预）
  | 'unsupported';                       // 我们还没有这条通道 ⇒ **如实报**

export interface OutboundRequest {
  intent: OutboundIntent;
  /** 原有通路的方法名（有值时先判"是不是我们这一类"） */
  method?: string;
  /** 原样透传的载荷（`host.openEmbeddedBrowser` 的 args 就放这儿） */
  payload?: Record<string, unknown>;
  /** 直接给的 URL（`open_tab` 用；不给则从 payload.url 取） */
  url?: string;
}

export interface OutboundPlan {
  channel: OutboundChannel;
  reason: string;
  url?: string;
  /** 将来接 MCP Apps 时对应的官方方法名（给我们自己看，不发给任何地方） */
  futureMethod?: string;
}

function pickUrl(req: OutboundRequest): string {
  const fromArg = typeof req.url === 'string' ? req.url : '';
  const fromPayload = typeof req.payload?.url === 'string' ? (req.payload.url as string) : '';
  return (fromArg || fromPayload).trim();
}

export function planOutbound(req: OutboundRequest): OutboundPlan {
  // ① 别的动作（不是"开页"这一类）⇒ 原样透传，绝不干预既有白名单动作
  if (typeof req.method === 'string' && req.method !== '' && req.method !== EMBEDDED_OPEN_METHOD) {
    return { channel: 'pass-through', reason: '不是"开页"这一类出口，原样交给原有通路' };
  }
  switch (req.intent) {
    case 'open_tab': {
      const url = pickUrl(req);
      if (!/^https?:\/\//i.test(url)) {
        return { channel: 'unsupported', reason: 'open_tab 需要一个 http(s) URL（给的是空或非 http）' };
      }
      return { channel: EMBEDDED_OPEN_METHOD, url, reason: '开进主窗的内嵌浏览器（主窗 tab）' };
    }
    case 'show_in_conversation':
      // 球今天的等价物 = 把内容当一条消息发出去（会话里看得见）
      return { channel: 'conversation.send', reason: '作为一条消息进会话（对应 MCP Apps 的 ui/message）',
               futureMethod: 'ui/message' };
    case 'model_only':
      // 🔴 **还没实现**：球当前没有"只写模型上下文、界面上不显示"的通道 ⇒ 如实报，不假装发成功。
      return { channel: 'unsupported',
               reason: '球当前没有"只进模型上下文、界面不显示"的通道（不许假成功）',
               futureMethod: 'ui/update-model-context' };
    default:
      return { channel: 'unsupported', reason: `未知意图 ${String(req.intent)}` };
  }
}
