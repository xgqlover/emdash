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
  normalizeXiangwoImages,
  openXiangwoImageSource,
  parseXiangwoImagesBlock,
  renderXiangwoImageGrid,
  xiangwoImageCells,
  xiangwoImageErrorAction,
  XIANGWO_IMAGES_MAX,
  XIANGWO_IMAGES_STORE_MAX,
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

  it('没有 page：卡片不可点（也不给手型），点它一次都不调桥', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const bridge = { orbApi: vi.fn(async () => ({ ok: true })) };
    const payload = payloadOf({ images: [{ url: RELATIVE_IMG, source: 'searxng' }] });
    const grid = renderXiangwoImageGrid(dom.window.document, payload, {
      baseUrl: BASE,
      botId: 'sxsj',
      bridge,
    });
    const button = grid.querySelector('.image-cell');
    expect(button?.className).toContain('image-cell-static');
    expect(button?.className).not.toContain('image-cell-clickable');
    // title 退化成图片地址（没有可开的页面）
    expect(button?.getAttribute('title')).toBe(`${BASE}${RELATIVE_IMG}`);

    click(dom, button as Element);
    expect(bridge.orbApi).not.toHaveBeenCalled();
    // 域名角标回落 source
    expect(grid.querySelector('.image-domain')?.textContent).toBe('searxng');
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
