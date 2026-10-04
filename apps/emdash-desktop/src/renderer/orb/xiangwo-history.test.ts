// [XG-CUSTOM 2026-10-04] 侧边枝历史拉回的回归测试。
//
// 覆盖四件事（对应「球重开/换机器不丢历史」的四个失败面）：
//   ① 拼 URL：基址带不带尾斜杠都对；基址为空 → 空串（调用方据此不发请求）；session_id 空则不带
//   ② 规范化：后端返回形状不对 / 空内容一律丢弃，且**永不抛**
//   ③ 映射：只产 `{ role, text }`（球的会话不认 timestamp）
//   ④ 取数：非 2xx / 网络抛错 / JSON 坏 / abort → 一律 undefined，绝不把异常抛给球
import { describe, expect, it, vi } from 'vitest';
import {
  buildSidebarHistoryUrl,
  fetchSidebarHistory,
  historyToMessages,
  normalizeSidebarHistory,
  SIDEBAR_HISTORY_MAX,
  SIDEBAR_HISTORY_TEXT_MAX,
} from './xiangwo-history';

const BASE = 'http://10.239.5.174:8900';

/** 造一个只填 ok/json 的假 fetch（真正的 fetch 类型签名用不上） */
function fetchReturning(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('buildSidebarHistoryUrl', () => {
  it('拼出绝对地址，bot 一律带上（空串 = 默认「项我」）', () => {
    expect(buildSidebarHistoryUrl(BASE, 'sxsj')).toBe(`${BASE}/sidebar/history?bot=sxsj`);
    expect(buildSidebarHistoryUrl(BASE, '')).toBe(`${BASE}/sidebar/history?bot=`);
  });

  it('基址尾斜杠不会拼出双斜杠，且容忍前后空白', () => {
    expect(buildSidebarHistoryUrl(`${BASE}/`, 'sxsj')).toBe(`${BASE}/sidebar/history?bot=sxsj`);
    expect(buildSidebarHistoryUrl(`  ${BASE}//  `, 'sxsj')).toBe(
      `${BASE}/sidebar/history?bot=sxsj`
    );
  });

  it('基址为空/非字符串 → 空串（调用方必须据此跳过请求）', () => {
    expect(buildSidebarHistoryUrl('', 'sxsj')).toBe('');
    expect(buildSidebarHistoryUrl('   ', 'sxsj')).toBe('');
    expect(buildSidebarHistoryUrl(undefined as unknown as string, 'sxsj')).toBe('');
  });

  it('session_id 有值才带；纯空白视为没有', () => {
    expect(buildSidebarHistoryUrl(BASE, 'sxsj', 'abc123')).toBe(
      `${BASE}/sidebar/history?bot=sxsj&session_id=abc123`
    );
    expect(buildSidebarHistoryUrl(BASE, 'sxsj', '   ')).toBe(`${BASE}/sidebar/history?bot=sxsj`);
  });

  it('bot 里的特殊字符会被转义（不破坏查询串）', () => {
    const url = buildSidebarHistoryUrl(BASE, 'a b&c=d');
    expect(url.startsWith(`${BASE}/sidebar/history?`)).toBe(true);
    expect(url).not.toContain('a b');
    expect(new URL(url).searchParams.get('bot')).toBe('a b&c=d');
  });
});

describe('normalizeSidebarHistory', () => {
  it('正常返回 → 逐条映射（content → text）', () => {
    const history = normalizeSidebarHistory({
      title: '打开 G-Mark',
      messages: [
        { role: 'user', content: '打开', timestamp: '2026-10-02T14:10:41' },
        { role: 'assistant', content: '打开了', timestamp: '2026-10-02T14:10:41' },
      ],
    });
    expect(history.title).toBe('打开 G-Mark');
    expect(history.messages).toEqual([
      { role: 'user', text: '打开', timestamp: '2026-10-02T14:10:41' },
      { role: 'assistant', text: '打开了', timestamp: '2026-10-02T14:10:41' },
    ]);
  });

  it('形状不对的行一律丢弃：null / 缺 content / content 非字符串 / 纯空白', () => {
    const history = normalizeSidebarHistory({
      messages: [
        null,
        'not-an-object',
        { role: 'user' },
        { role: 'user', content: 123 },
        { role: 'user', content: '   ' },
        { role: 'user', content: '留下我' },
      ],
    });
    expect(history.messages).toEqual([{ role: 'user', text: '留下我', timestamp: '' }]);
  });

  it('role 缺失/空 → 回落 assistant；timestamp 缺失 → 空串', () => {
    expect(normalizeSidebarHistory({ messages: [{ content: 'x' }] }).messages).toEqual([
      { role: 'assistant', text: 'x', timestamp: '' },
    ]);
    expect(
      normalizeSidebarHistory({ messages: [{ role: '', content: 'x' }] }).messages[0].role
    ).toBe('assistant');
    expect(
      normalizeSidebarHistory({ messages: [{ content: 'x', timestamp: 42 }] }).messages[0].timestamp
    ).toBe('');
  });

  it('超长 content 被截断（防后端改版灌爆 localStorage）', () => {
    const long = 'a'.repeat(SIDEBAR_HISTORY_TEXT_MAX + 500);
    expect(
      normalizeSidebarHistory({ messages: [{ content: long }] }).messages[0].text
    ).toHaveLength(SIDEBAR_HISTORY_TEXT_MAX);
  });

  it('条数超过上限时截断，不无界增长', () => {
    const rows = Array.from({ length: SIDEBAR_HISTORY_MAX + 20 }, (_, i) => ({ content: `m${i}` }));
    expect(normalizeSidebarHistory({ messages: rows }).messages).toHaveLength(SIDEBAR_HISTORY_MAX);
  });

  it('完全不是历史（null / 数组 / 空对象 / 非对象）→ 空结果，绝不抛', () => {
    for (const raw of [
      null,
      undefined,
      [],
      'oops',
      42,
      {},
      { messages: 'nope' },
      { messages: {} },
    ]) {
      expect(normalizeSidebarHistory(raw)).toEqual({ messages: [], title: '' });
    }
  });
});

describe('historyToMessages', () => {
  it('只产 { role, text }，不把 timestamp 带进会话', () => {
    const messages = historyToMessages({
      title: 't',
      messages: [{ role: 'user', text: 'a', timestamp: '2026-10-02T14:10:41' }],
    });
    expect(messages).toEqual([{ role: 'user', text: 'a' }]);
    expect(Object.keys(messages[0])).toEqual(['role', 'text']);
  });

  it('空历史 → 空数组', () => {
    expect(historyToMessages({ messages: [], title: '' })).toEqual([]);
  });
});

describe('fetchSidebarHistory', () => {
  it('正常返回 → 规范化后的历史，并以 GET 请求', async () => {
    const fetchImpl = fetchReturning({ title: 't', messages: [{ role: 'user', content: 'hi' }] });
    const history = await fetchSidebarHistory({
      url: `${BASE}/sidebar/history?bot=sxsj`,
      fetchImpl,
    });
    expect(history).toEqual({
      title: 't',
      messages: [{ role: 'user', text: 'hi', timestamp: '' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect((init as RequestInit).method).toBe('GET');
  });

  it('url 为空 → 直接 undefined，一次都不发请求', async () => {
    const fetchImpl = fetchReturning({ messages: [{ content: 'x' }] });
    expect(await fetchSidebarHistory({ url: '', fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('非 2xx / 网络抛错 / JSON 坏 → 一律 undefined（不抛给球）', async () => {
    expect(
      await fetchSidebarHistory({ url: BASE, fetchImpl: fetchReturning({}, false) })
    ).toBeUndefined();

    const throwing = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await fetchSidebarHistory({ url: BASE, fetchImpl: throwing })).toBeUndefined();

    const badJson = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;
    expect(await fetchSidebarHistory({ url: BASE, fetchImpl: badJson })).toBeUndefined();
  });

  it('把 signal 透传给 fetch（超时/取消由调用方控制）', async () => {
    const fetchImpl = fetchReturning({ messages: [] });
    const signal = AbortSignal.timeout(1000);
    await fetchSidebarHistory({ url: BASE, fetchImpl, signal });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect((calls[0][1] as RequestInit).signal).toBe(signal);
  });

  it('后端返回空 messages 时给出「空历史」而不是 undefined（调用方据此判断无需恢复）', async () => {
    const fetchImpl = fetchReturning({ messages: [], title: '' });
    expect(await fetchSidebarHistory({ url: BASE, fetchImpl })).toEqual({
      messages: [],
      title: '',
    });
  });
});
