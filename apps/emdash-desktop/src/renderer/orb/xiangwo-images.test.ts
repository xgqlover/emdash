// [XG-CUSTOM 2026-10-03] 项我球**图片协议 xiangwo-images** 的回归测试。
//
// 覆盖（对应任务书三条）：
//   ① 相对地址：`/xg/img?u=…` 按 agent 基址拼成绝对 URL；没有基址 → 该卡「图片不可用」占位，网格不崩
//   ② 点击：有 `page` → 走 `host.openEmbeddedBrowser`（内嵌浏览器）；没有 `page` → 一次都不调
//   ③ 单张图 onerror → 只有那一张退化成「文字 + 域名」（可点），其它卡分毫不动
// 另含协议既有行为的回归：≤60 条上限、坏 JSON 不吞消息、历史只落前 24 条且保留相对地址。
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
  compactXiangwoImagesBlock,
  isAgentLocalAddress,
  normalizeXiangwoImages,
  openXiangwoImageSource,
  parseXiangwoImagesBlock,
  renderXiangwoImageGrid,
  xiangwoImageCells,
  xiangwoImageErrorAction,
  xiangwoOpenFailureNotice,
  XIANGWO_IMAGES_MAX,
  XIANGWO_IMAGES_STORE_MAX,
  type XiangwoOpenSourceResult,
} from './xiangwo-images';

const BASE = 'http://10.239.5.174:8900';
const RELATIVE_IMG = '/xg/img?u=https%3A%2F%2Fp3-pc-sign.douyinpic.com%2Fa.jpg';

function payloadOf(raw: unknown) {
  const payload = normalizeXiangwoImages(raw);
  if (payload === undefined) throw new Error('payload 归一化失败');
  return payload;
}

/** 造一个"点一下"的鼠标事件（jsdom 里 click() 也会走 click 监听，但显式派发更贴近真机） */
function click(dom: JSDOM, element: Element): void {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

describe('[XG-CUSTOM] xiangwo-images ① 相对地址按 agent 基址拼绝对', () => {
  it('`/xg/img?u=…` → base + 相对路径；page 同理', () => {
    const payload = payloadOf({
      images: [
        {
          url: RELATIVE_IMG,
          alt: '烘焙插画',
          source: 'searxng',
          page: '/xg/page?id=42',
        },
      ],
    });
    const cells = xiangwoImageCells(payload, BASE);
    expect(cells[0]?.src).toBe(`${BASE}${RELATIVE_IMG}`);
    expect(cells[0]?.openUrl).toBe(`${BASE}/xg/page?id=42`);
    expect(cells[0]?.textOnly).toBe(false);
    // 域名角标取 page 的 host（拼出来后就是 agent 主机的域名）
    expect(cells[0]?.domain).toBe('10.239.5.174:8900');
  });

  it('已是 http(s) 的原样用；thumb 优先于 url；`//host/x` 按 base 协议补全', () => {
    const absolute = payloadOf({
      images: [{ url: 'https://cdn.example.com/a.jpg', thumb: 'https://cdn.example.com/a_t.jpg' }],
    });
    const cells = xiangwoImageCells(absolute, BASE);
    expect(cells[0]?.src).toBe('https://cdn.example.com/a_t.jpg');
    expect(cells[0]?.retrySrc).toBe('https://cdn.example.com/a.jpg');

    const protocolRelative = payloadOf({ images: [{ url: '//cdn.example.com/b.jpg' }] });
    expect(xiangwoImageCells(protocolRelative, BASE)[0]?.src).toBe('http://cdn.example.com/b.jpg');
    expect(xiangwoImageCells(protocolRelative, 'https://h:8900')[0]?.src).toBe(
      'https://cdn.example.com/b.jpg'
    );
  });

  it('没有基址 → 相对地址的卡「图片不可用」占位，同一网格里绝对地址的卡照常', () => {
    const payload = payloadOf({
      images: [
        { url: RELATIVE_IMG, page: 'https://zcool.com.cn/work/1.html', source: 'zcool' },
        { url: 'https://cdn.example.com/ok.jpg' },
      ],
    });
    const cells = xiangwoImageCells(payload, '');
    expect(cells[0]?.src).toBe('');
    expect(cells[0]?.textOnly).toBe(true);
    expect(cells[0]?.openUrl).toBe('https://zcool.com.cn/work/1.html'); // 有 page 仍然可点
    expect(cells[1]?.src).toBe('https://cdn.example.com/ok.jpg');

    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const grid = renderXiangwoImageGrid(dom.window.document, payload, { baseUrl: '' });
    // 球据此知道"基址到了要重画"（见 orb.js 的 applyAgentBaseUrl）
    expect(grid.querySelector('.image-grid-needs-base')).not.toBeNull();
    const buttons = [...grid.querySelectorAll('.image-cell')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.querySelector('.image-fallback')?.textContent).toContain('图片不可用');
    expect(buttons[0]?.querySelector('img')).toBeNull();
    expect(buttons[1]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/ok.jpg'
    );
  });
});

describe('[XG-CUSTOM] xiangwo-images ② 点击 → 内嵌浏览器打开来源页', () => {
  it('有 page：整卡可点 → host.openEmbeddedBrowser(page, bot)，title 挂完整 URL', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const bridge = { orbApi: vi.fn(async () => ({ ok: true })) };
    const payload = payloadOf({
      images: [
        {
          url: RELATIVE_IMG,
          alt: '作品页',
          page: 'https://www.zcool.com.cn/work/Z1.html',
          source: 'zcool',
        },
      ],
    });
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
    });
    const button = grid.querySelector('.image-cell');
    expect(button).not.toBeNull();
    expect(button?.className).toContain('image-cell-clickable');
    expect(button?.getAttribute('title')).toBe('https://www.zcool.com.cn/work/Z1.html');
    expect(grid.querySelector('.image-domain')?.textContent).toBe('www.zcool.com.cn');

    click(dom, button as Element);
    expect(bridge.orbApi).toHaveBeenCalledTimes(1);
    expect(bridge.orbApi).toHaveBeenCalledWith('host.openEmbeddedBrowser', {
      url: 'https://www.zcool.com.cn/work/Z1.html',
      bot: 'sxsj',
    });
  });

  it('★ 没有 page（新协议）：仍可点，打开的是**原始地址**而不是我们的 /xg/img 代理', () => {
    // [XG-CUSTOM 2026-10-14] 协议变更：原「只认 page、拿不到就不开」⇒ 真机反馈「点了没反应」；
    //   现为 `page` → `orig` 原文 → 从 `/xg/img?u=…` 解出原始地址。判据：打开的 URL 必须是原始地址。
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const bridge = { orbApi: vi.fn(async () => ({ ok: true })) };
    const payload = payloadOf({ images: [{ url: RELATIVE_IMG, source: 'searxng' }] });
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
    });
    const button = grid.querySelector('.image-cell');
    expect(button?.className).toContain('image-cell-clickable');
    const rawUrl = decodeURIComponent(String(RELATIVE_IMG).split('u=')[1] ?? '');
    expect(button?.getAttribute('title')).toBe(rawUrl);

    click(dom, button as Element);
    expect(bridge.orbApi).toHaveBeenCalledWith('host.openEmbeddedBrowser', {
      url: rawUrl,
      bot: 'sxsj',
    });
  });

  it('★ A 打底：内嵌开不了（no-task）⇒ 自动退系统浏览器（host.openExternal），并如实回报原因码', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const calls: Array<[string, unknown]> = [];
    const bridge = {
      orbApi: vi.fn(async (method: string, params: unknown) => {
        calls.push([method, params]);
        if (method === 'host.openEmbeddedBrowser') return { ok: false, reason: 'no-task' };
        return { ok: true };
      }),
    };
    const payload = payloadOf({ images: [{ url: RELATIVE_IMG, source: 'searxng' }] });
    const failures: unknown[] = [];
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
      onOpenFailure: (r) => failures.push(r),
    });
    click(dom, grid.querySelector('.image-cell') as Element);
    await Promise.resolve();
    await Promise.resolve();
    const rawUrl = decodeURIComponent(String(RELATIVE_IMG).split('u=')[1] ?? '');
    expect(calls.map((c) => c[0])).toEqual(['host.openEmbeddedBrowser', 'host.openExternal']);
    expect(calls[1]?.[1]).toEqual({ url: rawUrl });
    expect(failures).toEqual([{ ok: false, reason: 'opened-external' }]);
  });

  it('openXiangwoImageSource：非 http(s) / 没有桥 → 什么都不做（不悄悄开系统浏览器）', () => {
    const bridge = { orbApi: vi.fn(async () => ({ ok: true })) };
    openXiangwoImageSource('', 'sxsj', bridge);
    openXiangwoImageSource('/xg/page?id=1', 'sxsj', bridge);
    openXiangwoImageSource('javascript:alert(1)', 'sxsj', bridge);
    expect(bridge.orbApi).not.toHaveBeenCalled();

    openXiangwoImageSource('https://a.example/w', '', undefined);
    openXiangwoImageSource('https://a.example/w', '', {});
    expect(bridge.orbApi).not.toHaveBeenCalled();

    openXiangwoImageSource('https://a.example/w', '', bridge);
    expect(bridge.orbApi).toHaveBeenCalledWith('host.openEmbeddedBrowser', {
      url: 'https://a.example/w',
    });
  });
});

// [XG-CUSTOM 2026-10-12] 修法 2：**失败要看得见** —— 球里点链接/图片卡开页失败时，
// 球显示一行人话回执（`.transcript-action-notice`），`reason` 原样带出。
describe('[XG-CUSTOM] xiangwo-images ②′ 开页失败 → 回执文案 + 回调', () => {
  /** 把微任务队列冲干净（openXiangwoImageSource 的 .then 在下一轮才跑） */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('★ 每个已知原因码都有话说，且**原因码原样带出**（排障就靠它）', () => {
    for (const reason of ['no-task', 'no-task-view', 'unavailable', 'timeout', 'bad-url', 'failed']) {
      const text = xiangwoOpenFailureNotice({ ok: false, reason }, 'https://a.example/w');
      expect(text).not.toBe('');
      expect(text).toContain(reason);
    }
  });

  it('★ 未知原因码也不许静默：原样带出（不把 reason 翻译没了）', () => {
    const text = xiangwoOpenFailureNotice({ ok: false, reason: 'weird-code' }, 'https://a.example/w');
    expect(text).toContain('weird-code');
    expect(text).not.toBe('');
  });

  it('成功不受影响：{ok:true} → 空文案（成功不吵用户）', () => {
    expect(xiangwoOpenFailureNotice({ ok: true }, 'https://a.example/w')).toBe('');
  });

  it('R7 兜底：agent 本机地址只**提示一句**、绝不改写 URL', () => {
    expect(isAgentLocalAddress('http://127.0.0.1:8900/x')).toBe(true);
    expect(isAgentLocalAddress('http://localhost:8900/x')).toBe(true);
    expect(isAgentLocalAddress('https://a.example/w')).toBe(false);
    expect(isAgentLocalAddress('https://127.0.0.1.evil.example/w')).toBe(false);

    const text = xiangwoOpenFailureNotice(
      { ok: false, reason: 'unavailable' },
      'http://127.0.0.1:8900/x'
    );
    expect(text).toContain('本机地址');
    // 只提示、不改写：原文里的地址一个字符都不许被换掉
    expect(text).not.toContain('10.239.5.174');
  });

  it('★ 主进程回 {ok:false, reason} → onFailure 拿到**同一个 reason**', async () => {
    const failures: XiangwoOpenSourceResult[] = [];
    openXiangwoImageSource(
      'https://a.example/w',
      'sxsj',
      { orbApi: async () => ({ ok: false, reason: 'no-task' }) },
      (result) => failures.push(result)
    );
    await flush();
    expect(failures).toEqual([{ ok: false, reason: 'no-task' }]);
  });

  it('★ 成功路径不受影响：回 {ok:true} → onFailure 一次都不调', async () => {
    const failures: XiangwoOpenSourceResult[] = [];
    openXiangwoImageSource(
      'https://a.example/w',
      '',
      { orbApi: async () => ({ ok: true }) },
      (result) => failures.push(result)
    );
    await flush();
    expect(failures).toEqual([]);
  });

  it('桥没接上（undefined / 没有 orbApi）→ 同步就有回执，不静默', () => {
    const failures: XiangwoOpenSourceResult[] = [];
    const collect = (result: XiangwoOpenSourceResult): void => {
      failures.push(result);
    };
    openXiangwoImageSource('https://a.example/w', '', undefined, collect);
    openXiangwoImageSource('https://a.example/w', '', {}, collect);
    expect(failures).toEqual([
      { ok: false, reason: 'unavailable' },
      { ok: false, reason: 'unavailable' },
    ]);
  });

  it('调不通（抛）/ 回了个不是对象的玩意 → 都算失败（reason: unavailable / failed）', async () => {
    const failures: XiangwoOpenSourceResult[] = [];
    const collect = (result: XiangwoOpenSourceResult): void => {
      failures.push(result);
    };
    openXiangwoImageSource(
      'https://a.example/w',
      '',
      {
        orbApi: async () => {
          throw new Error('boom');
        },
      },
      collect
    );
    openXiangwoImageSource('https://a.example/w', '', { orbApi: async () => null }, collect);
    await flush();
    // 两条异步路各自落地，**顺序不定**（rejection 比 resolution 多一跳微任务）⇒ 只断言内容集合
    expect(failures.map((item) => item.reason).sort()).toEqual([
      'failed',
      'unavailable',
    ]);
  });

  it('整卡点击走同一条回执（renderXiangwoImageGrid 的 onOpenFailure 带上 url）', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const bridge = { orbApi: vi.fn(async () => ({ ok: false, reason: 'no-task-view' })) };
    const seen: Array<{ result: XiangwoOpenSourceResult; url: string }> = [];
    const payload = payloadOf({
      images: [{ url: RELATIVE_IMG, page: 'https://www.zcool.com.cn/work/Z1.html' }],
    });
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
      onOpenFailure: (result, url) => seen.push({ result, url }),
    });
    click(dom, grid.querySelector('.image-cell') as Element);
    await flush();
    expect(seen).toEqual([
      { result: { ok: false, reason: 'no-task-view' }, url: 'https://www.zcool.com.cn/work/Z1.html' },
    ]);
  });
});

describe('[XG-CUSTOM] xiangwo-images ③ 单图 onerror 不影响其它卡', () => {
  it('第一张：thumb 挂了换 url 重试，再挂才退化；另两张分毫不动', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const bridge = { orbApi: vi.fn(async () => ({ ok: true })) };
    const payload = payloadOf({
      images: [
        {
          url: 'https://cdn.example.com/1.jpg',
          thumb: 'https://cdn.example.com/1_t.jpg',
          page: 'https://a.example/work/1',
          alt: '第一张',
        },
        { url: RELATIVE_IMG, page: 'https://b.example/work/2' },
        { url: 'https://cdn.example.com/3.jpg' },
      ],
    });
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
    });
    const cells = [...grid.querySelectorAll('.image-cell')];
    expect(cells).toHaveLength(3);
    const first = cells[0] as Element;
    const firstImg = first.querySelector('img') as HTMLImageElement;

    // 第一次 error → 换候选地址（url）重试，不退化
    firstImg.dispatchEvent(new dom.window.Event('error'));
    expect(firstImg.getAttribute('src')).toBe('https://cdn.example.com/1.jpg');
    expect(first.querySelector('.image-fallback')).toBeNull();

    // 第二次 error → 只这一张退化成"文字 + 域名"（仍然可点开来源页）
    firstImg.dispatchEvent(new dom.window.Event('error'));
    const fallback = first.querySelector('.image-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('图片加载失败');
    expect(first.className).toContain('failed');
    expect(first.querySelector('.image-domain')?.textContent).toBe('a.example');
    expect((firstImg as HTMLImageElement).style.display).toBe('none');

    // 其它两张完全没被影响
    expect(cells[1]?.querySelector('.image-fallback')).toBeNull();
    expect(cells[1]?.querySelector('img')?.getAttribute('src')).toBe(`${BASE}${RELATIVE_IMG}`);
    expect(cells[2]?.querySelector('.image-fallback')).toBeNull();
    expect(cells[2]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/3.jpg'
    );

    // 退化后的卡照样能点开来源页（3 张里只有第 1 张有 page）
    click(dom, first);
    expect(bridge.orbApi).toHaveBeenCalledWith('host.openEmbeddedBrowser', {
      url: 'https://a.example/work/1',
      bot: 'sxsj',
    });
    click(dom, cells[2] as Element);
    expect(bridge.orbApi).toHaveBeenCalledTimes(1);
  });

  it('没有候选可重试的卡（只有 url）第一次 error 就退化', () => {
    const cell = xiangwoImageCells(payloadOf({ images: [{ url: 'https://cdn/x.jpg' }] }), BASE)[0];
    if (cell === undefined) throw new Error('没有 cell');
    expect(cell.retrySrc).toBe('');
    expect(xiangwoImageErrorAction(cell, false)).toEqual({ action: 'degrade' });
  });
});

describe('[XG-CUSTOM] xiangwo-images 协议回归（上限 / 坏 JSON / 历史压缩）', () => {
  it('≤60 条上限不放宽；重试候选是 thumb→url→orig', () => {
    const many = payloadOf({
      images: Array.from({ length: 70 }, (_, index) => ({
        url: `https://cdn.example.com/${String(index)}.jpg`,
      })),
    });
    expect(many.images).toHaveLength(XIANGWO_IMAGES_MAX);

    const cell = xiangwoImageCells(
      payloadOf({
        images: [
          {
            url: 'https://cdn.example.com/a.jpg',
            thumb: 'https://cdn.example.com/a_t.jpg',
            orig: 'https://origin.example.com/a_orig.jpg',
          },
        ],
      }),
      BASE
    )[0];
    if (cell === undefined) throw new Error('没有 cell');
    expect(cell.src).toBe('https://cdn.example.com/a_t.jpg');
    expect(cell.retrySrc).toBe('https://cdn.example.com/a.jpg');
    expect(xiangwoImageErrorAction(cell, false)).toEqual({
      action: 'retry',
      src: 'https://cdn.example.com/a.jpg',
    });
    expect(xiangwoImageErrorAction(cell, true)).toEqual({ action: 'degrade' });
  });

  it('解析块：相对地址 + page/orig 一起进来，块不残留在文字里；坏 JSON 不吞消息', () => {
    const block = [
      '看这几张：',
      '```xiangwo-images',
      JSON.stringify({
        title: '烘焙插画',
        images: [{ url: RELATIVE_IMG, page: 'https://zcool.com.cn/w/1', orig: '/xg/img?u=big' }],
      }),
      '```',
    ].join('\n');
    const parsed = parseXiangwoImagesBlock(block);
    expect(parsed.text).toBe('看这几张：');
    expect(parsed.images?.title).toBe('烘焙插画');
    expect(parsed.images?.images[0]?.page).toBe('https://zcool.com.cn/w/1');
    expect(parsed.images?.images[0]?.orig).toBe('/xg/img?u=big');

    const broken = parseXiangwoImagesBlock('```xiangwo-images\n{不是JSON}\n```');
    expect(broken.images).toBeUndefined();
    expect(broken.text).toContain('{不是JSON}');

    const empty = parseXiangwoImagesBlock('```xiangwo-images\n{"images":[{"url":"data:image/png;base64,xx"}]}\n```');
    expect(empty.images).toBeUndefined();
    expect(empty.text).toContain('data:image/png');
  });

  it('历史压缩：只落前 24 条、保留相对地址、不落 dataURL', () => {
    const images = Array.from({ length: 30 }, (_, index) =>
      index === 0
        ? { url: RELATIVE_IMG, page: 'https://zcool.com.cn/w/1' }
        : { url: `https://cdn.example.com/${String(index)}.jpg` }
    );
    const text = '```xiangwo-images\n' + JSON.stringify({ title: 'T', images }) + '\n```';
    const compacted = compactXiangwoImagesBlock(text);
    const reparsed = parseXiangwoImagesBlock(compacted);
    expect(reparsed.images?.images).toHaveLength(XIANGWO_IMAGES_STORE_MAX);
    expect(reparsed.images?.images[0]?.url).toBe(RELATIVE_IMG);
    expect(reparsed.images?.title).toBe('T');
    expect(compacted).not.toContain('data:image');

    // 本来就 ≤24 条 → 原样返回（不重排 JSON）
    const small = '```xiangwo-images\n' + JSON.stringify({ images: [images[1]] }) + '\n```';
    expect(compactXiangwoImagesBlock(small)).toBe(small);
  });
});
