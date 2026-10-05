// [XG-CUSTOM 2026-10-05] 项我球 **MCP 工具市场协议 xiangwo-mcp** 的回归测试。
//
// 覆盖：① 解析（正常/无块/坏 JSON 不吞消息/空服务器不认）② 归一化容错（脏字段、缺 totals、上限）
//      ③ 卡片渲染（标题计数/传输与健康徽标/密钥**只显示键名**/写类工具标记/工具名折叠）
//      ④ **分面过滤**（一个输入框同时过滤服务器名与工具名）⑤ 落历史紧凑块（裁工具名且仍可解析）
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  compactXiangwoMcpBlock,
  normalizeXiangwoMcpMarket,
  parseXiangwoMcpBlock,
  renderXiangwoMcpMarket,
  summarizeXiangwoMcpMarket,
  xiangwoMcpHealth,
  XIANGWO_MCP_STORE_TOOLS_MAX,
} from './xiangwo-mcp';

const MARKET = {
  servers: [
    {
      name: 'openviking',
      transport: 'http',
      target: 'http://127.0.0.1:1933/mcp',
      enabled: true,
      toolCount: 15,
      tools: ['find', 'search', 'read', 'remember', 'write', 'edit'],
      writeTools: ['remember', 'write', 'edit'],
      secretKeys: ['headers.Authorization'],
      calls: 2,
      failures: 0,
      maxMs: 756,
      enumFailed: false,
    },
    {
      name: 'WeKnora',
      transport: 'stdio',
      target: 'python weknora_mcp_server.py',
      enabled: true,
      toolCount: 28,
      tools: ['hybrid_search', 'list_tenants', 'create_knowledge_base'],
      writeTools: ['create_knowledge_base'],
      secretKeys: ['env.WEKNORA_API_KEY'],
      calls: 0,
      failures: 0,
      maxMs: 0,
      enumFailed: false,
    },
  ],
  totals: { servers: 2, tools: 43, writeTools: 4, calls: 2 },
  catalogAgeSeconds: 396,
};

function doc(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

describe('xiangwo-mcp 协议解析', () => {
  it('正常块 → 解析出市场数据 + 文本里去掉块', () => {
    const text = `前面的说明\n\`\`\`xiangwo-mcp\n${JSON.stringify(MARKET)}\n\`\`\`\n后面的收尾`;
    const parsed = parseXiangwoMcpBlock(text);
    expect(parsed.market?.servers).toHaveLength(2);
    expect(parsed.text).toContain('前面的说明');
    expect(parsed.text).toContain('后面的收尾');
    expect(parsed.text).not.toContain('xiangwo-mcp');
  });

  it('没有块 → 原样返回（不吞消息）', () => {
    const parsed = parseXiangwoMcpBlock('就是一句普通回答');
    expect(parsed.market).toBeUndefined();
    expect(parsed.text).toBe('就是一句普通回答');
  });

  it('坏 JSON → 原样返回（不吞消息、不抛）', () => {
    const parsed = parseXiangwoMcpBlock('```xiangwo-mcp\n{ 这不是 json\n```');
    expect(parsed.market).toBeUndefined();
    expect(parsed.text).toContain('这不是 json');
  });

  it('servers 为空 → 不认（原样返回）', () => {
    const parsed = parseXiangwoMcpBlock('```xiangwo-mcp\n{"servers":[]}\n```');
    expect(parsed.market).toBeUndefined();
  });
});

describe('xiangwo-mcp 归一化容错', () => {
  it('脏字段被丢弃/修正，不抛', () => {
    const market = normalizeXiangwoMcpMarket({
      servers: [{ name: 'a', toolCount: '7', tools: ['x', 'x', '', 42], enabled: false }],
    });
    expect(market?.servers[0].toolCount).toBe(7);
    expect(market?.servers[0].tools).toEqual(['x']); // 去重 + 丢空 + 丢非字符串
    expect(market?.servers[0].enabled).toBe(false);
  });

  it('没有 name 的服务器被丢弃；全丢光 → undefined', () => {
    expect(normalizeXiangwoMcpMarket({ servers: [{ toolCount: 3 }] })).toBeUndefined();
  });

  it('缺 totals 时按服务器汇总兜底', () => {
    const market = normalizeXiangwoMcpMarket({
      servers: [
        { name: 'a', toolCount: 5, writeTools: ['w'], calls: 1 },
        { name: 'b', toolCount: 3, writeTools: [], calls: 2 },
      ],
    });
    expect(market?.totals).toEqual({ servers: 2, tools: 8, writeTools: 1, calls: 3 });
  });

  it('健康态三档（可用/枚举失败/未启用）', () => {
    const base = {
      name: 'x',
      transport: 'http',
      target: '',
      enabled: true,
      toolCount: 1,
      tools: [],
      writeTools: [],
      secretKeys: [],
      calls: 0,
      failures: 0,
      maxMs: 0,
      enumFailed: false,
    };
    expect(xiangwoMcpHealth(base).tone).toBe('ok');
    expect(xiangwoMcpHealth({ ...base, toolCount: 0, enumFailed: true }).label).toBe('枚举失败');
    expect(xiangwoMcpHealth({ ...base, enabled: false }).tone).toBe('off');
    expect(xiangwoMcpHealth({ ...base, failures: 3 }).tone).toBe('warn');
  });
});

describe('xiangwo-mcp 卡片渲染', () => {
  it('标题带总数，服务器卡带传输/健康徽标与计数', () => {
    const market = normalizeXiangwoMcpMarket(MARKET)!;
    const el = renderXiangwoMcpMarket(doc(), market);
    expect(el.querySelector('.mcp-market-title')?.textContent).toBe(
      summarizeXiangwoMcpMarket(market)
    );
    expect(el.querySelectorAll('.mcp-server')).toHaveLength(2);
    const heads = [...el.querySelectorAll('.mcp-server-head')].map((n) => n.textContent ?? '');
    expect(heads[0]).toContain('openviking');
    expect(heads[0]).toContain('http');
    expect(heads[0]).toContain('可用');
    expect(heads[0]).toContain('15 工具');
    expect(heads[0]).toContain('调用 2 次');
    expect(heads[0]).toContain('最慢 756ms');
  });

  it('密钥**只渲染键名**（值在 agent 侧已脱敏，这里不回显任何值）', () => {
    const el = renderXiangwoMcpMarket(doc(), normalizeXiangwoMcpMarket(MARKET)!);
    const secrets = [...el.querySelectorAll('.mcp-server-secrets')].map((n) => n.textContent ?? '');
    expect(secrets[0]).toContain('headers.Authorization');
    expect(secrets[1]).toContain('env.WEKNORA_API_KEY');
    // 卡片里不该出现任何形如 token/密钥值的串
    expect(el.textContent ?? '').not.toMatch(/(Bearer\s|sk-|api[_-]?key\s*[:=]\s*\S)/i);
  });

  it('写类工具标记 + title 提示（审批卡）', () => {
    const el = renderXiangwoMcpMarket(doc(), normalizeXiangwoMcpMarket(MARKET)!);
    const writes = [...el.querySelectorAll('.mcp-tool-write')].map((n) => n.textContent);
    expect(writes).toContain('write');
    expect(writes).toContain('remember');
    const chip = [...el.querySelectorAll('.mcp-tool-write')].find((n) => n.textContent === 'write');
    expect(chip?.getAttribute('title')).toContain('审批卡');
    const plain = [...el.querySelectorAll('.mcp-tool:not(.mcp-tool-write)')].map(
      (n) => n.textContent
    );
    expect(plain).toContain('find');
  });

  it('工具名超上限折叠成「…共 N 个」', () => {
    const many = normalizeXiangwoMcpMarket({
      servers: [
        { name: 'big', toolCount: 60, tools: Array.from({ length: 60 }, (_, i) => `t${i}`) },
      ],
    })!;
    const el = renderXiangwoMcpMarket(doc(), many);
    expect(el.querySelectorAll('.mcp-tool:not(.mcp-tool-more)')).toHaveLength(24);
    expect(el.querySelector('.mcp-tool-more')?.textContent).toContain('共 60 个');
  });
});

describe('xiangwo-mcp 分面过滤', () => {
  it('按服务器名过滤', () => {
    const el = renderXiangwoMcpMarket(doc(), normalizeXiangwoMcpMarket(MARKET)!);
    const filter = el.querySelector<HTMLInputElement>('.mcp-market-filter')!;
    const cards = [...el.querySelectorAll<HTMLElement>('.mcp-server')];
    filter.value = 'weknora';
    filter.dispatchEvent(new (filter.ownerDocument.defaultView as typeof window).Event('input'));
    expect(cards[0].hidden).toBe(true);
    expect(cards[1].hidden).toBe(false);
  });

  it('按工具名过滤（服务器名不含它时也能筛出来）', () => {
    const el = renderXiangwoMcpMarket(doc(), normalizeXiangwoMcpMarket(MARKET)!);
    const filter = el.querySelector<HTMLInputElement>('.mcp-market-filter')!;
    const cards = [...el.querySelectorAll<HTMLElement>('.mcp-server')];
    filter.value = 'hybrid_search';
    filter.dispatchEvent(new (filter.ownerDocument.defaultView as typeof window).Event('input'));
    expect(cards[0].hidden).toBe(true); // openviking 没有这个工具
    expect(cards[1].hidden).toBe(false);
    filter.value = '';
    filter.dispatchEvent(new (filter.ownerDocument.defaultView as typeof window).Event('input'));
    expect(cards.every((c) => !c.hidden)).toBe(true);
  });
});

describe('xiangwo-mcp 落历史紧凑块', () => {
  it('裁工具名但保留计数与 totals，且仍能被解析', () => {
    const many = normalizeXiangwoMcpMarket({
      servers: [
        {
          name: 'big',
          toolCount: 60,
          tools: Array.from({ length: 60 }, (_, i) => `t${i}`),
          writeTools: Array.from({ length: 60 }, (_, i) => `w${i}`),
        },
      ],
    })!;
    const block = compactXiangwoMcpBlock(many);
    const reparsed = parseXiangwoMcpBlock(block);
    expect(reparsed.market?.servers[0].tools).toHaveLength(XIANGWO_MCP_STORE_TOOLS_MAX);
    expect(reparsed.market?.servers[0].toolCount).toBe(60); // 计数不缩水
    expect(reparsed.market?.totals.tools).toBe(60);
  });
});
