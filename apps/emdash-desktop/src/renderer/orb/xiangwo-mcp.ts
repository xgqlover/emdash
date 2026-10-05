// [XG-CUSTOM 2026-10-05] 项我球**MCP 工具市场协议 xiangwo-mcp** —— 协议解析 + 卡片渲染
// （agent 侧生成：`xiangwo-agent/xg_mcp_market.py`；这里只负责"把块变成球上的面板"）。
//
// 为什么要它：本地接了 3 个服务器 58 个工具，但**没有任何地方能一眼看全** ——
// 配置要手改 `~/.xiangwo/mcp.json`，工具要靠 `mcp_list` 现查（日志 27 次），调用统计当天才补上。
// 对照开源（OpenHands `features/mcp-page/`：installed-server-card / mcp-server-health /
// save-as-secret-toggle + `mcp-section-filter.ts` 分面过滤；assistant-ui `tool-group.tsx`）：
// **抄语义不引库**，复用手搓块协议 + DOM 渲染。
//
// 协议（agent 输出一个单独成段的 fenced JSON 块）：
//   ```xiangwo-mcp
//   {"servers":[{"name":"openviking","transport":"http","target":"http://127.0.0.1:1933/mcp",
//     "enabled":true,"toolCount":15,"tools":["find","search",…],"writeTools":["write","edit",…],
//     "secretKeys":["headers.Authorization"],"calls":2,"failures":0,"maxMs":756,"enumFailed":false}],
//    "totals":{"servers":3,"tools":58,"writeTools":17,"calls":2},"catalogAgeSeconds":396}
//   ```
// 安全：**卡片只显示密钥的键名**（值在 agent 侧就已脱敏，这里不再做任何回显）。
//
// 回归测试见 ./xiangwo-mcp.test.ts。

export const XIANGWO_MCP_BLOCK_RE = /```xiangwo-mcp\s*([\s\S]*?)```/;

/** 卡片上每个服务器最多列多少个工具名（再多就折叠成"…共 N 个"） */
export const XIANGWO_MCP_TOOLS_MAX = 24;
/** 落历史时每个服务器最多保留多少个工具名（历史不该被工具名撑爆） */
export const XIANGWO_MCP_STORE_TOOLS_MAX = 12;

export type XiangwoMcpServer = {
  name: string;
  transport: string;
  target: string;
  enabled: boolean;
  toolCount: number;
  tools: string[];
  writeTools: string[];
  secretKeys: string[];
  calls: number;
  failures: number;
  maxMs: number;
  enumFailed: boolean;
};

export type XiangwoMcpMarket = {
  servers: XiangwoMcpServer[];
  totals: { servers: number; tools: number; writeTools: number; calls: number };
  catalogAgeSeconds?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 0): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return max > 0 ? raw.slice(0, max) : raw;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function strList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const name = text(item, 120);
    if (name === '' || out.includes(name)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** 归一化（脏数据一律丢弃该字段，绝不抛；整块没有可用服务器 → undefined） */
export function normalizeXiangwoMcpMarket(raw: unknown): XiangwoMcpMarket | undefined {
  const root = asRecord(raw);
  const list = Array.isArray(root.servers) ? root.servers : [];
  const servers: XiangwoMcpServer[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    const name = text(entry.name, 60);
    if (name === '') continue;
    servers.push({
      name,
      transport: text(entry.transport, 12) || 'stdio',
      target: text(entry.target, 200),
      enabled: entry.enabled !== false,
      toolCount: Math.max(0, Math.floor(num(entry.toolCount))),
      tools: strList(entry.tools, 60),
      writeTools: strList(entry.writeTools, 60),
      secretKeys: strList(entry.secretKeys, 12),
      calls: Math.max(0, Math.floor(num(entry.calls))),
      failures: Math.max(0, Math.floor(num(entry.failures))),
      maxMs: Math.max(0, num(entry.maxMs)),
      enumFailed: entry.enumFailed === true,
    });
    if (servers.length >= 40) break;
  }
  if (servers.length === 0) return undefined;
  const totalsRaw = asRecord(root.totals);
  const age = num(root.catalogAgeSeconds);
  const market: XiangwoMcpMarket = {
    servers,
    totals: {
      servers: Math.floor(num(totalsRaw.servers)) || servers.length,
      tools: Math.floor(num(totalsRaw.tools)) || servers.reduce((sum, s) => sum + s.toolCount, 0),
      writeTools:
        Math.floor(num(totalsRaw.writeTools)) ||
        servers.reduce((sum, s) => sum + s.writeTools.length, 0),
      calls: Math.floor(num(totalsRaw.calls)) || servers.reduce((sum, s) => sum + s.calls, 0),
    },
  };
  if (age > 0) market.catalogAgeSeconds = Math.round(age);
  return market;
}

/** 从助手回复里解析市场块：找不到/坏 JSON → 原样返回文本（**绝不吞消息**） */
export function parseXiangwoMcpBlock(textValue: unknown): {
  text: string;
  market?: XiangwoMcpMarket;
} {
  const source = typeof textValue === 'string' ? textValue : '';
  const match = XIANGWO_MCP_BLOCK_RE.exec(source);
  if (match === null) return { text: source };
  let market: XiangwoMcpMarket | undefined;
  try {
    market = normalizeXiangwoMcpMarket(JSON.parse(match[1].trim()));
  } catch {
    market = undefined;
  }
  if (market === undefined) return { text: source };
  const stripped = source.replace(XIANGWO_MCP_BLOCK_RE, '').trim();
  return { text: stripped, market };
}

/** 落历史用的紧凑块（裁掉长工具名列表；数值字段原样保留） */
export function compactXiangwoMcpBlock(market: XiangwoMcpMarket): string {
  const compact: XiangwoMcpMarket = {
    servers: market.servers.map((server) => ({
      ...server,
      tools: server.tools.slice(0, XIANGWO_MCP_STORE_TOOLS_MAX),
      writeTools: server.writeTools.slice(0, XIANGWO_MCP_STORE_TOOLS_MAX),
    })),
    totals: market.totals,
  };
  if (market.catalogAgeSeconds !== undefined) compact.catalogAgeSeconds = market.catalogAgeSeconds;
  return `\`\`\`xiangwo-mcp\n${JSON.stringify(compact)}\n\`\`\``;
}

/** 健康态（卡片上的徽标） */
export function xiangwoMcpHealth(server: XiangwoMcpServer): {
  ok: boolean;
  tone: 'ok' | 'warn' | 'off';
  label: string;
} {
  if (!server.enabled) return { ok: false, tone: 'off', label: '未启用' };
  if (server.toolCount === 0) {
    return { ok: false, tone: 'warn', label: server.enumFailed ? '枚举失败' : '无工具' };
  }
  if (server.failures > 0) {
    return { ok: true, tone: 'warn', label: `${String(server.failures)} 次失败` };
  }
  return { ok: true, tone: 'ok', label: '可用' };
}

/** 市场摘要（卡片头 + 也可以给别的 UI 复用） */
export function summarizeXiangwoMcpMarket(market: XiangwoMcpMarket): string {
  const { servers, tools, writeTools, calls } = market.totals;
  return (
    `MCP 工具市场 · ${String(servers)} 个服务器 / ${String(tools)} 个工具` +
    `（写类 ${String(writeTools)} · 调用过 ${String(calls)} 次）`
  );
}

/** 渲染市场卡片（含**分面过滤**：一个输入框同时过滤服务器与工具名） */
export function renderXiangwoMcpMarket(doc: Document, market: XiangwoMcpMarket): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'mcp-market';

  const head = doc.createElement('div');
  head.className = 'mcp-market-head';
  const title = doc.createElement('div');
  title.className = 'mcp-market-title';
  title.textContent = summarizeXiangwoMcpMarket(market);
  head.append(title);
  if (market.catalogAgeSeconds !== undefined) {
    const age = doc.createElement('div');
    age.className = 'mcp-market-age';
    age.textContent = `工具清单缓存 ${String(market.catalogAgeSeconds)}s 前生成`;
    head.append(age);
  }
  root.append(head);

  const filter = doc.createElement('input');
  filter.className = 'mcp-market-filter';
  filter.setAttribute('type', 'search');
  filter.setAttribute('placeholder', '过滤服务器 / 工具名…');
  root.append(filter);

  const body = doc.createElement('div');
  body.className = 'mcp-market-body';
  const cards: { element: HTMLElement; haystack: string }[] = [];

  for (const server of market.servers) {
    const card = doc.createElement('div');
    card.className = 'mcp-server';
    const health = xiangwoMcpHealth(server);

    const cardHead = doc.createElement('div');
    cardHead.className = 'mcp-server-head';
    const name = doc.createElement('span');
    name.className = 'mcp-server-name';
    name.textContent = server.name;
    cardHead.append(name);

    const transport = doc.createElement('span');
    transport.className = 'mcp-badge';
    transport.textContent = server.transport;
    cardHead.append(transport);

    const healthBadge = doc.createElement('span');
    healthBadge.className = `mcp-badge mcp-health-${health.tone}`;
    healthBadge.textContent = health.label;
    cardHead.append(healthBadge);

    const counts = doc.createElement('span');
    counts.className = 'mcp-server-counts';
    counts.textContent =
      `${String(server.toolCount)} 工具 · 写类 ${String(server.writeTools.length)}` +
      ` · 调用 ${String(server.calls)} 次` +
      (server.failures > 0 ? `（失败 ${String(server.failures)}）` : '') +
      (server.maxMs > 0 ? ` · 最慢 ${String(Math.round(server.maxMs))}ms` : '');
    cardHead.append(counts);
    card.append(cardHead);

    if (server.target !== '') {
      const target = doc.createElement('div');
      target.className = 'mcp-server-target';
      target.textContent = server.target;
      card.append(target);
    }
    if (server.secretKeys.length > 0) {
      const secrets = doc.createElement('div');
      secrets.className = 'mcp-server-secrets';
      // 只显示**键名**：值在 agent 侧已脱敏，这里也不回显
      secrets.textContent = `密钥：${server.secretKeys.join('、')}`;
      card.append(secrets);
    }

    const toolBox = doc.createElement('div');
    toolBox.className = 'mcp-tools';
    const shown = server.tools.slice(0, XIANGWO_MCP_TOOLS_MAX);
    for (const tool of shown) {
      const chip = doc.createElement('span');
      const isWrite = server.writeTools.includes(tool);
      chip.className = isWrite ? 'mcp-tool mcp-tool-write' : 'mcp-tool';
      chip.textContent = tool;
      if (isWrite) chip.setAttribute('title', '写类工具：执行前会出审批卡');
      toolBox.append(chip);
    }
    if (server.tools.length > shown.length) {
      const more = doc.createElement('span');
      more.className = 'mcp-tool mcp-tool-more';
      more.textContent = `…共 ${String(server.toolCount)} 个`;
      toolBox.append(more);
    }
    card.append(toolBox);
    body.append(card);
    cards.push({
      element: card,
      haystack:
        `${server.name} ${server.tools.join(' ')} ${server.writeTools.join(' ')}`.toLowerCase(),
    });
  }
  root.append(body);

  filter.addEventListener('input', () => {
    const needle = filter.value.trim().toLowerCase();
    for (const item of cards) {
      item.element.hidden = needle !== '' && !item.haystack.includes(needle);
    }
  });

  return root;
}
