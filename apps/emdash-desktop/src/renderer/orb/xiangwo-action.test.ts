// [XG-CUSTOM] 2026-10-05 —— 动作块解析/执行回归（jsdom 无关，纯函数）。
import { describe, expect, it } from 'vitest';
import {
  actionFailureText,
  dropOpenUrlActionsAlreadyOpened,
  openXiangwoUrls,
  createSideEffectPrimer,
  parseXiangwoOpenUrlBlock,
  stripXiangwoOpenUrlBlocks,
  parseXiangwoActionBlock,
  runXiangwoAction,
  stripXiangwoActionBlocks,
  XIANGWO_DIRECT_ACTIONS,
  XIANGWO_OPEN_EMBEDDED_BROWSER_ID,
} from './xiangwo-action';

describe('parseXiangwoActionBlock', () => {
  it('解析单个动作', () => {
    const got = parseXiangwoActionBlock('好的\n```xiangwo-action\n{"id":"app.settings"}\n```\n');
    expect(got).toEqual([{ id: 'app.settings' }]);
  });

  it('带参数 / 数组多动作', () => {
    const got = parseXiangwoActionBlock(
      '```xiangwo-action\n[{"id":"view.task"},{"id":"app.newTask","args":{"title":"油瓶包装"}}]\n```'
    );
    expect(got).toEqual([{ id: 'view.task' }, { id: 'app.newTask', args: { title: '油瓶包装' } }]);
  });

  it('★坏 JSON / 缺 id → 跳过，不抛（宁可少做一个动作也不打断回复）', () => {
    expect(parseXiangwoActionBlock('```xiangwo-action\n{不是 json}\n```')).toEqual([]);
    expect(parseXiangwoActionBlock('```xiangwo-action\n{"args":{}}\n```')).toEqual([]);
    expect(parseXiangwoActionBlock('```xiangwo-action\n\n```')).toEqual([]);
  });

  it('无块 → 空数组；正文其它部分不受影响', () => {
    expect(parseXiangwoActionBlock('普通回复')).toEqual([]);
    expect(stripXiangwoActionBlocks('A\n```xiangwo-action\n{"id":"x.y"}\n```\nB')).toBe('A\n\nB');
  });
});

describe('runXiangwoAction', () => {
  it('成功：run 收到 host.runCommand + 原样 id', async () => {
    const calls: unknown[] = [];
    const got = await runXiangwoAction({ id: 'app.settings' }, async (method, payload) => {
      calls.push([method, payload]);
      return { ok: true };
    });
    expect(got).toEqual({ ok: true });
    expect(calls[0]).toEqual(['host.runCommand', { id: 'app.settings' }]);
  });

  it('★失败回执照原样带出来（不假装成功）', async () => {
    const got = await runXiangwoAction({ id: 'app.newTask' }, async () => ({
      ok: false,
      reason: 'needs-approval',
    }));
    expect(got).toEqual({ ok: false, reason: 'needs-approval' });
    expect(actionFailureText({ id: 'app.newTask' }, got)).toContain('需要你确认');
  });

  it('★run 抛异常 → 收敛成 failed，不抛', async () => {
    const got = await runXiangwoAction({ id: 'app.settings' }, async () => {
      throw new Error('通道断了');
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('failed');
    expect(got.message).toContain('通道断了');
  });

  it('四种失败原因都有对应人话', () => {
    const a = { id: 'x.y' };
    for (const reason of ['needs-approval', 'unknown-command', 'unavailable', 'weird']) {
      expect(actionFailureText(a, { ok: false, reason }).length).toBeGreaterThan(4);
    }
    expect(actionFailureText(a, { ok: false, reason: 'unknown-command' })).toContain(
      '不在可执行清单'
    );
  });
});

// [XG-CUSTOM] 2026-10-06 「用文字指挥 emdash 开网页」：动作块 → 直连 host.openEmbeddedBrowser。
//   背景：白名单（`host.runCommand`）里**没有开网页的命令**，但 `host.openEmbeddedBrowser` 本就是
//   独立、已接好的 orbApi 方法（球里点图片卡片走的就是它）。所以这条路**不查白名单**。
describe('runXiangwoAction · 开网页直连', () => {
  it('★开网页块 → 走 host.openEmbeddedBrowser（不是 host.runCommand），url 原样透传', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const got = await runXiangwoAction(
      { id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID, args: { url: 'https://example.com/a?b=1' } },
      async (method, payload) => {
        calls.push([method, payload]);
        return { ok: true };
      }
    );
    expect(got).toEqual({ ok: true });
    expect(calls).toEqual([['host.openEmbeddedBrowser', { url: 'https://example.com/a?b=1' }]]);
    // 反证：绝不能同时（或代替地）去打白名单那条
    expect(calls.filter(([method]) => method === 'host.runCommand')).toEqual([]);
  });

  it('解析出来的块同样直连（端到端：块 → run 的 method）', async () => {
    const block =
      '```xiangwo-action\n' +
      '{"id":"host.openEmbeddedBrowser","args":{"url":"http://localhost:3080","bot":"xg"}}\n```';
    const actions = parseXiangwoActionBlock(`开好了\n${block}`);
    expect(actions).toEqual([
      { id: 'host.openEmbeddedBrowser', args: { url: 'http://localhost:3080', bot: 'xg' } },
    ]);
    const calls: Array<[string, Record<string, unknown>]> = [];
    await runXiangwoAction(actions[0]!, async (method, payload) => {
      calls.push([method, payload]);
      return { ok: true };
    });
    expect(calls[0]).toEqual([
      'host.openEmbeddedBrowser',
      { url: 'http://localhost:3080', bot: 'xg' },
    ]);
  });

  it('bot 选填：空 / 非字符串 / 不传 → payload 里没有 bot 键', async () => {
    const argsList: unknown[] = [
      { url: 'https://a.example' },
      { url: 'https://a.example', bot: '  ' },
      { url: 'https://a.example', bot: 42 },
    ];
    for (const args of argsList) {
      const calls: Array<[string, Record<string, unknown>]> = [];
      const got = await runXiangwoAction(
        { id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID, args },
        async (method, payload) => {
          calls.push([method, payload]);
          return { ok: true };
        }
      );
      expect(got).toEqual({ ok: true });
      expect(calls[0]).toEqual(['host.openEmbeddedBrowser', { url: 'https://a.example' }]);
    }
  });

  it('★非法 url（javascript: / 空串 / 缺 url / 非字符串 / file:）→ ok:false + bad-url，且一次调用都没发', async () => {
    const badArgs: unknown[] = [
      { url: 'javascript:alert(1)' },
      { url: '' },
      { url: '   ' },
      {},
      { url: 123 },
      { url: 'file:///etc/passwd' },
      { url: 'data:text/html,<b>x</b>' },
      'https://example.com', // args 整个不是对象
      undefined,
    ];
    for (const args of badArgs) {
      let called = 0;
      const action: { id: string; args?: unknown } = { id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID };
      if (args !== undefined) action.args = args;
      const got = await runXiangwoAction(action, async () => {
        called += 1;
        return { ok: true };
      });
      expect(got).toEqual({ ok: false, reason: 'bad-url' });
      expect(called).toBe(0); // 不假装成功、也不回退系统浏览器
    }
  });

  it('★主进程回 ok:false 照原样带出（unavailable 不粉饰）', async () => {
    const got = await runXiangwoAction(
      { id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID, args: { url: 'https://example.com' } },
      async () => ({ ok: false, reason: 'unavailable' })
    );
    expect(got).toEqual({ ok: false, reason: 'unavailable' });
    expect(actionFailureText({ id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID }, got)).toContain('没接上');
  });

  it('★直连表只登记开网页这一个 id（不许顺手放开别的）', () => {
    expect(Object.keys(XIANGWO_DIRECT_ACTIONS)).toEqual([XIANGWO_OPEN_EMBEDDED_BROWSER_ID]);
    expect(XIANGWO_DIRECT_ACTIONS['host.runCommand']).toBeUndefined();
    expect(XIANGWO_DIRECT_ACTIONS['host.openExternal']).toBeUndefined();
  });

  it('★普通命令零回归：app.settings 仍然走 host.runCommand', async () => {
    const calls: unknown[] = [];
    const got = await runXiangwoAction({ id: 'app.settings' }, async (method, payload) => {
      calls.push([method, payload]);
      return { ok: true };
    });
    expect(got).toEqual({ ok: true });
    expect(calls[0]).toEqual(['host.runCommand', { id: 'app.settings' }]);
  });
});

// [XG-CUSTOM 2026-10-05] `xiangwo-open-url`（方案 A）回归。
describe('xiangwo-open-url（方案 A）', () => {
  it('解析单个 url（对象形式）并剥离块', () => {
    const text =
      '好的，帮你打开\n```xiangwo-open-url\n{"url":"https://www.g-mark.org/zh-CN/gallery/winners"}\n```\n';
    expect(parseXiangwoOpenUrlBlock(text)).toEqual([
      'https://www.g-mark.org/zh-CN/gallery/winners',
    ]);
    expect(stripXiangwoOpenUrlBlocks(text)).toBe('好的，帮你打开');
  });

  it('数组多 url + 去重 + **只收 http(s)**', () => {
    const text =
      '```xiangwo-open-url\n[{"url":"https://a.example"},{"url":"https://a.example"},"http://b.example","ftp://c","javascript:alert(1)"]\n```';
    expect(parseXiangwoOpenUrlBlock(text)).toEqual(['https://a.example', 'http://b.example']);
  });

  it('★坏 JSON / 空块 → 跳过不抛；纯文本块 → 也认（宽容）', () => {
    expect(parseXiangwoOpenUrlBlock('```xiangwo-open-url\n{不是 json}\n```')).toEqual([]);
    expect(parseXiangwoOpenUrlBlock('```xiangwo-open-url\n\n```')).toEqual([]);
  });

  it('★无块 → 空数组（零副作用，旧回复不受影响）', () => {
    expect(parseXiangwoOpenUrlBlock('普通回复，没有块')).toEqual([]);
    expect(stripXiangwoOpenUrlBlocks('普通回复')).toBe('普通回复');
  });

  it('★执行：走 host.openEmbeddedBrowser（已注入的通道），逐个调', async () => {
    const calls: unknown[] = [];
    const got = await openXiangwoUrls(
      ['https://a.example', 'https://b.example'],
      async (method, payload) => {
        calls.push([method, payload]);
        return { ok: true };
      }
    );
    expect(got).toEqual({ ok: true });
    expect(calls).toEqual([
      ['host.openEmbeddedBrowser', { url: 'https://a.example' }],
      ['host.openEmbeddedBrowser', { url: 'https://b.example' }],
    ]);
  });

  it('★失败如实回报（不假装开好了）：拿不到通道 → unavailable', async () => {
    const got = await openXiangwoUrls(['https://a.example'], async () => ({
      ok: false,
      reason: 'unavailable',
    }));
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('unavailable');
    expect(got.message).toContain('https://a.example');
  });

  it('★run 抛异常 → failed，不抛；空数组 → 直接 ok', async () => {
    const boom = await openXiangwoUrls(['https://a.example'], async () => {
      throw new Error('桥断了');
    });
    expect(boom.ok).toBe(false);
    expect(boom.reason).toBe('failed');
    expect(await openXiangwoUrls([], async () => ({ ok: true }))).toEqual({ ok: true });
  });
});

// ── [XG-CUSTOM 2026-10-06] 「球开网页」收敛：两种块都出现时只开一次 ──
describe('dropOpenUrlActionsAlreadyOpened（收敛：防开两次）', () => {
  const openAction = (url: string) => ({
    id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID,
    args: { url },
  });

  it('open-url 块开过的同一个 URL → 直连表那份被丢掉', () => {
    const acts = [openAction('https://a.example/x')];
    expect(dropOpenUrlActionsAlreadyOpened(acts, ['https://a.example/x'])).toEqual([]);
  });

  it('URL 不同（或带/不带空白）→ 都保留（该开的还得开）', () => {
    const acts = [openAction('https://a.example/x'), openAction('https://b.example/y')];
    const kept = dropOpenUrlActionsAlreadyOpened(acts, ['https://b.example/y']);
    expect(kept.map((a) => (a.args as { url: string }).url)).toEqual(['https://a.example/x']);
  });

  it('空白差异也算同一个 URL（trim 后比较）', () => {
    expect(
      dropOpenUrlActionsAlreadyOpened(
        [openAction('  https://a.example/x  ')],
        ['https://a.example/x']
      )
    ).toEqual([]);
  });

  it('**只对"开网页"这一个 id 生效**：别的动作（app.settings 等）永不被丢', () => {
    const acts = [
      { id: 'app.settings' },
      { id: 'app.newTask', args: { url: 'https://a.example' } },
    ];
    expect(dropOpenUrlActionsAlreadyOpened(acts, ['https://a.example'])).toHaveLength(2);
  });

  it('零回归：openedUrls 为空 / 没有 url / url 非法 → 原样返回', () => {
    const acts = [openAction('https://a.example/x')];
    expect(dropOpenUrlActionsAlreadyOpened(acts, [])).toEqual(acts);
    expect(
      dropOpenUrlActionsAlreadyOpened(
        [{ id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID }],
        ['https://a.example']
      )
    ).toHaveLength(1);
    expect(
      dropOpenUrlActionsAlreadyOpened(
        [{ id: XIANGWO_OPEN_EMBEDDED_BROWSER_ID, args: {} }],
        ['https://a.example']
      )
    ).toHaveLength(1);
    expect(
      dropOpenUrlActionsAlreadyOpened([openAction('not-a-url')], ['https://a.example'])
    ).toHaveLength(1);
  });

  it('保序且不动原对象（只做过滤）', () => {
    const first = { id: 'app.settings' };
    const second = openAction('https://a.example/x');
    const kept = dropOpenUrlActionsAlreadyOpened([first, second], ['https://a.example/x']);
    expect(kept).toEqual([first]);
    expect(kept[0]).toBe(first);
  });

  it('端到端形状：同一条回复里两种块 + 同一 URL → 只走一次 open-url 路径', () => {
    const reply = [
      '给你开一下',
      '```xiangwo-open-url',
      '{"url":"https://a.example/x"}',
      '```',
      '```xiangwo-action',
      '{"id":"host.openEmbeddedBrowser","args":{"url":"https://a.example/x"}}',
      '```',
    ].join('\n');
    const openUrls = parseXiangwoOpenUrlBlock(reply);
    const actions = parseXiangwoActionBlock(reply);
    expect(openUrls).toEqual(['https://a.example/x']);
    expect(actions).toHaveLength(1);
    expect(dropOpenUrlActionsAlreadyOpened(actions, openUrls)).toEqual([]);
  });
});

// ── [XG-CUSTOM] 2026-10-06 副作用只执行一次（治"一次请求冒 4~5 个同样的页"）──
describe('createSideEffectPrimer（渲染重绘不重放副作用）', () => {
  const live = () => ({ role: 'assistant', text: '', xgLive: true });

  it('同一条实时消息 + 同一个 key → 只有第一次认领成功（重绘多少次都只开一次）', () => {
    const p = createSideEffectPrimer();
    const m = live();
    expect(p.claim(m, 'open:https://a.example')).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      expect(p.claim(m, 'open:https://a.example')).toBe(false);
    }
  });

  it('流式后到的新 URL 仍各开一次（不重放、也不漏开）', () => {
    const p = createSideEffectPrimer();
    const m = live();
    expect(p.claim(m, 'open:https://a.example')).toBe(true);
    expect(p.claim(m, 'open:https://b.example')).toBe(true);
    expect(p.claim(m, 'open:https://a.example')).toBe(false);
  });

  it('不同消息各自认领（两条消息各开各的）', () => {
    const p = createSideEffectPrimer();
    expect(p.claim(live(), 'open:https://a.example')).toBe(true);
    expect(p.claim(live(), 'open:https://a.example')).toBe(true);
  });

  it('🔴 历史消息（没有 xgLive）永远不执行副作用 —— 重启/切会话重绘不会把旧页全开一遍', () => {
    const p = createSideEffectPrimer();
    const history = {
      role: 'assistant',
      text: '```xiangwo-open-url\n{"url":"https://old.example"}\n```',
    };
    expect(p.claim(history, 'open:https://old.example')).toBe(false);
    expect(p.claim(history, 'open:https://old.example')).toBe(false);
  });

  it('动作类副作用同样按 key 去重（同一动作参数只跑一次）', () => {
    const p = createSideEffectPrimer();
    const m = live();
    const key = 'action:view.task:{"taskId":"t1"}';
    expect(p.claim(m, key)).toBe(true);
    expect(p.claim(m, key)).toBe(false);
    expect(p.claim(m, 'action:view.task:{"taskId":"t2"}')).toBe(true);
  });

  it('传进非对象（null/undefined）→ 一律不认领，不抛', () => {
    const p = createSideEffectPrimer();
    expect(p.claim(null as unknown as object, 'open:https://a.example')).toBe(false);
    expect(p.claim(undefined as unknown as object, 'open:https://a.example')).toBe(false);
  });
});
