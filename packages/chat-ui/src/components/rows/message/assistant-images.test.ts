/**
 * [XG-CUSTOM 2026-10-09] Unit tests for the agent-image card helpers.
 *
 * The bridge contract these cover (see assistant-images.ts):
 *   - the `[XG-IMG-META]` marker is ALWAYS stripped from the visible text,
 *     even when its JSON is broken (users must never see machine markers);
 *   - metadata pairs with images by index, `min(len)`;
 *   - caption = `alt` else `source`; badge = host(`page`) else `source`;
 *   - only http(s) `page` values become click targets.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_IMAGE_CAPTION,
  ASSISTANT_IMAGE_GAP,
  ASSISTANT_IMAGE_THUMB,
  assistantImageDataUrl,
  assistantImageGridHeight,
  buildAssistantImages,
  hostOf,
  isOpenablePage,
  splitAssistantImageMeta,
} from './assistant-images';

const META = (payload: unknown): string =>
  `看图：[XG-IMG-META]${JSON.stringify(payload)}[/XG-IMG-META]`;

describe('splitAssistantImageMeta', () => {
  it('strips the marker and returns the metadata array', () => {
    const result = splitAssistantImageMeta(
      META([{ alt: '猫', source: 'searxng', page: 'https://a.test/p' }])
    );
    expect(result.text).toBe('看图：');
    expect(result.meta).toEqual([{ alt: '猫', source: 'searxng', page: 'https://a.test/p' }]);
  });

  it('always strips the marker even when the JSON is broken', () => {
    const result = splitAssistantImageMeta('前面 [XG-IMG-META]{not json[/XG-IMG-META] 后面');
    expect(result.text).toBe('前面  后面');
    expect(result.meta).toEqual([]);
  });

  it('tolerates missing fields and non-array payloads', () => {
    expect(splitAssistantImageMeta(META([{ alt: '只有 alt' }])).meta).toEqual([
      { alt: '只有 alt', source: '', page: '' },
    ]);
    expect(splitAssistantImageMeta(META({ images: [] })).meta).toEqual([]);
  });

  it('leaves ordinary text untouched', () => {
    expect(splitAssistantImageMeta('就是一句话')).toEqual({ text: '就是一句话', meta: [] });
  });
});

describe('buildAssistantImages', () => {
  const blocks = [
    { mimeType: 'image/png', data: 'AAA' },
    { mimeType: 'image/jpeg', data: 'BBB' },
  ];

  it('pairs by index and derives caption + badge from the metadata', () => {
    const images = buildAssistantImages('m1', blocks, [
      { alt: '第一张', source: 'searxng', page: 'https://a.test/x' },
      { alt: '', source: 'zcool', page: '' },
    ]);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      id: 'm1#img0',
      caption: '第一张',
      page: 'https://a.test/x',
      sourceHost: 'a.test',
    });
    // alt empty -> caption falls back to source; no page -> no badge/click target.
    expect(images[1]).toMatchObject({ caption: 'zcool', sourceHost: 'zcool' });
    expect(images[1]?.page).toBeUndefined();
  });

  it('ignores extra metadata and survives missing metadata (images only)', () => {
    const only = buildAssistantImages('m1', blocks, []);
    expect(only).toHaveLength(2);
    expect(only[0]?.caption).toBeUndefined();
    expect(only[0]?.sourceHost).toBeUndefined();

    const short = buildAssistantImages('m1', blocks, [
      { alt: 'a', source: '', page: '' },
      { alt: 'b', source: '', page: '' },
      { alt: 'c', source: '', page: '' },
    ]);
    expect(short.map((image) => image.caption)).toEqual(['a', 'b']);
  });

  it('never treats a non-http page as a click target', () => {
    const [image] = buildAssistantImages('m1', blocks, [
      { alt: '', source: '', page: '/xg/img?u=x' },
    ]);
    expect(image?.page).toBeUndefined();
  });
});

describe('data url + geometry', () => {
  it('composes the data URL from the delivered mime type', () => {
    expect(assistantImageDataUrl({ mimeType: 'image/webp', data: 'ZZZ' })).toBe(
      'data:image/webp;base64,ZZZ'
    );
    expect(assistantImageDataUrl({ mimeType: '', data: 'ZZZ' })).toBe('data:image/png;base64,ZZZ');
  });

  it('computes a deterministic grid height that matches the row math', () => {
    expect(assistantImageGridHeight(0, 600)).toBe(0);
    const cell = ASSISTANT_IMAGE_THUMB + ASSISTANT_IMAGE_CAPTION;
    // 3 per row at 600px: floor((600+8)/(148+8)) = 3.
    expect(assistantImageGridHeight(1, 600)).toBe(cell + ASSISTANT_IMAGE_GAP);
    expect(assistantImageGridHeight(3, 600)).toBe(cell + ASSISTANT_IMAGE_GAP);
    expect(assistantImageGridHeight(4, 600)).toBe(
      2 * cell + ASSISTANT_IMAGE_GAP + ASSISTANT_IMAGE_GAP
    );
    // Narrow viewport degrades to one column instead of dividing by zero.
    expect(assistantImageGridHeight(2, 0)).toBe(2 * cell + 2 * ASSISTANT_IMAGE_GAP);
  });

  it('extracts hosts and only accepts http(s) pages', () => {
    expect(hostOf('https://www.pixiv.net/artworks/1')).toBe('www.pixiv.net');
    expect(hostOf('/xg/img')).toBe('');
    expect(isOpenablePage('https://a.test')).toBe(true);
    expect(isOpenablePage('file:///tmp/a.png')).toBe(false);
  });
});
