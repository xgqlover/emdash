// [XG-CUSTOM 2026-10-10] 共享图片协议（`xiangwo-images`）的单元测试。
//
// 这是**球 + 主聊天窗两个面的共同回归网**：球面 `orb/xiangwo-images.test.ts`、
// 主窗面 `assistant-images.test.ts` 继续覆盖各自的渲染/几何，这里覆盖**协议与语义本身**
// （归一化、解析/剥离、落盘压缩、ACP marker、caption/badge 口径）。

import { describe, expect, it } from 'vitest';
import {
  badgeOf,
  captionOf,
  compactXiangwoImagesBlock,
  hostOf,
  normalizeXiangwoImages,
  parseXiangwoImagesBlock,
  splitXiangwoImageMeta,
  XIANGWO_IMAGES_MAX,
  XIANGWO_IMAGES_STORE_MAX,
} from './xiangwo-images';

const block = (payload: unknown): string =>
  '```xiangwo-images\n' + JSON.stringify(payload) + '\n```';

describe('normalizeXiangwoImages', () => {
  it('keeps address-like entries and drops everything else', () => {
    const payload = normalizeXiangwoImages({
      title: '参考',
      images: [
        { url: 'https://a.com/x.png', alt: 'a', source: 'searxng', page: 'https://a.com/p' },
        { url: 'not-an-address' }, // 丢掉：没有任何可拼的地址
        { page: '/xg/img?u=x' }, // 保留：只有 page 也算
        { orig: '//cdn/x.jpg' }, // 保留：协议相对
        { url: '/rel.png' }, // 保留：相对路径**原样**
      ],
    });
    expect(payload?.images).toHaveLength(4);
    expect(payload?.images[0]).toMatchObject({ url: 'https://a.com/x.png', source: 'searxng' });
    expect(payload?.images[1]).toMatchObject({ url: '', page: '/xg/img?u=x' });
    expect(payload?.images[2]).toMatchObject({ orig: '//cdn/x.jpg' });
    expect(payload?.images[3]).toMatchObject({ url: '/rel.png' });
  });

  it('returns undefined when nothing survives (caller keeps the text as-is)', () => {
    expect(normalizeXiangwoImages({ images: [{ url: 'nope' }] })).toBeUndefined();
    expect(normalizeXiangwoImages(null)).toBeUndefined();
    expect(normalizeXiangwoImages({})).toBeUndefined();
  });

  it(`caps at ${XIANGWO_IMAGES_MAX} entries and truncates title/alt/source`, () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ url: `https://a.com/${i}.png` }));
    const payload = normalizeXiangwoImages({ title: 'T'.repeat(300), images: many });
    expect(payload?.images).toHaveLength(XIANGWO_IMAGES_MAX);
    expect(payload?.title).toHaveLength(200);
    const one = normalizeXiangwoImages({
      images: [{ url: 'https://a.com/x.png', alt: 'A'.repeat(300), source: 'S'.repeat(100) }],
    });
    expect(one?.images[0]?.alt).toHaveLength(200);
    expect(one?.images[0]?.source).toHaveLength(60);
  });
});

describe('parseXiangwoImagesBlock', () => {
  it('parses and strips a well-formed fenced block', () => {
    const out = parseXiangwoImagesBlock(`看图\n\n${block({ images: [{ url: '/a.png' }] })}\n完`);
    expect(out.images?.images).toHaveLength(1);
    expect(out.text).not.toContain('xiangwo-images');
    expect(out.text).toContain('看图');
    expect(out.text).toContain('完');
  });

  it('keeps a broken block in the text (never swallows user content)', () => {
    const raw = '前言\n\n```xiangwo-images\n{broken json\n```\n\n后语';
    const out = parseXiangwoImagesBlock(raw);
    expect(out.images).toBeUndefined();
    expect(out.text).toContain('{broken json'); // 既有契约：坏 JSON 不吞
  });

  it('always strips legacy [XG-IMG] markers, even empty or unparseable ones', () => {
    const out = parseXiangwoImagesBlock(
      '看图[XG-IMG]https://a.com/x.png[/XG-IMG]空[XG-IMG][/XG-IMG]完'
    );
    expect(out.text).toBe('看图空完');
    expect(out.images?.images).toHaveLength(1);
    expect(out.images?.images[0]?.url).toBe('https://a.com/x.png');
  });

  it('prefers the fenced block over legacy markers when both exist', () => {
    const out = parseXiangwoImagesBlock(
      `${block({ images: [{ url: 'https://block.png' }] })}[XG-IMG]https://legacy.png[/XG-IMG]`
    );
    expect(out.images?.images).toHaveLength(1);
    expect(out.images?.images[0]?.url).toBe('https://block.png');
    expect(out.text).not.toContain('XG-IMG');
  });
});

describe('compactXiangwoImagesBlock', () => {
  it(`keeps only the first ${XIANGWO_IMAGES_STORE_MAX} entries when the block is long`, () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://a.com/${i}.png` }));
    const out = compactXiangwoImagesBlock(`x\n${block({ title: 'T', images: many })}\ny`);
    expect(out).toContain('```xiangwo-images');
    const parsed = JSON.parse(/```xiangwo-images\s*([\s\S]*?)```/.exec(out)?.[1] ?? '{}') as {
      images: unknown[];
      title?: string;
    };
    expect(parsed.images).toHaveLength(XIANGWO_IMAGES_STORE_MAX);
    expect(parsed.title).toBe('T');
  });

  it('leaves short blocks, absent blocks and broken JSON untouched', () => {
    const short = `x\n${block({ images: [{ url: '/a.png' }] })}\ny`;
    expect(compactXiangwoImagesBlock(short)).toBe(short);
    expect(compactXiangwoImagesBlock('没有块')).toBe('没有块');
    const broken = '```xiangwo-images\n{broken\n```';
    expect(compactXiangwoImagesBlock(broken)).toBe(broken);
  });
});

describe('splitXiangwoImageMeta (ACP variant)', () => {
  it('strips the marker and pairs entries by index', () => {
    const marker = '[XG-IMG-META][{"alt":"a","source":"bing","page":"https://p/1"}][/XG-IMG-META]';
    const out = splitXiangwoImageMeta(`正文\n\n${marker}`);
    expect(out.text).toBe('正文');
    expect(out.meta).toEqual([{ alt: 'a', source: 'bing', page: 'https://p/1' }]);
  });

  it('always strips the marker, even when the JSON is broken or not an array', () => {
    const broken = splitXiangwoImageMeta('正文[XG-IMG-META]{oops[/XG-IMG-META]');
    expect(broken.text).toBe('正文');
    expect(broken.meta).toEqual([]);
    const notArray = splitXiangwoImageMeta('[XG-IMG-META]{"a":1}[/XG-IMG-META]尾');
    expect(notArray.text).toBe('尾');
    expect(notArray.meta).toEqual([]);
  });

  it('handles empty markers, several markers, and junk entries', () => {
    const out = splitXiangwoImageMeta(
      '[XG-IMG-META][/XG-IMG-META]A[XG-IMG-META][{"alt":"x"}][/XG-IMG-META]B'
    );
    expect(out.text).toBe('AB');
    expect(out.meta).toEqual([{ alt: 'x', source: '', page: '' }]);
  });

  it('truncates alt/source but keeps the full page, and is not stateful across calls', () => {
    const entry = { alt: 'A'.repeat(300), source: 'S'.repeat(100), page: 'P'.repeat(500) };
    const src = `[XG-IMG-META]${JSON.stringify([entry])}[/XG-IMG-META]`;
    const first = splitXiangwoImageMeta(src);
    const second = splitXiangwoImageMeta(src);
    expect(first.meta[0]?.alt).toHaveLength(200);
    expect(first.meta[0]?.source).toHaveLength(80);
    expect(first.meta[0]?.page).toHaveLength(500);
    expect(second.meta).toEqual(first.meta); // 没有共享 /g 状态
    expect(hostOf('https://a.com/x')).toBe('a.com');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('captionOf / badgeOf (shared semantics)', () => {
  it('caption = alt, else source', () => {
    expect(captionOf({ alt: '标题', source: 'bing' })).toBe('标题');
    expect(captionOf({ alt: '', source: 'bing' })).toBe('bing');
    expect(captionOf({ alt: '  ', source: 'bing' })).toBe('bing');
    expect(captionOf({})).toBe('');
  });

  it('badge = host(page), else source', () => {
    expect(badgeOf({ page: 'https://www.pexels.com/photo/x-1/', source: 'pexels' })).toBe(
      'www.pexels.com'
    );
    expect(badgeOf({ page: '', source: 'pixelrag' })).toBe('pixelrag');
    expect(badgeOf({ page: 'not-a-url', source: 'zcool' })).toBe('zcool');
    expect(badgeOf({})).toBe('');
  });

  it('badge prefers the resolved page (orb resolves relative pages against the agent base)', () => {
    // 球：相对 page 先拼绝对，角标取拼后的 host —— 这是原来的行为，共享份必须能表达它
    expect(badgeOf({ page: '/xg/img?u=x', source: 'pixelrag' }, 'https://agent.local/x.png')).toBe(
      'agent.local'
    );
    expect(badgeOf({ page: '/xg/img?u=x', source: 'pixelrag' }, '')).toBe('pixelrag');
  });
});
