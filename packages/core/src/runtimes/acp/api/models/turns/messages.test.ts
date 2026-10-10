/**
 * [XG-CUSTOM 2026-10-10] Wire-boundary tests for agent image metadata.
 *
 * `historyPageSchema` (= `transcriptTurnSchema` -> `transcriptItemSchema` -> `transcriptMessageSchema`)
 * is what the runtime parses history through. The `images` array already existed; `uri`,
 * `caption` and `sourceHost` were added to it when the 项我 bridge moved off the custom
 * `[XG-IMG-META]` text marker onto ACP's **native** `ImageContent.uri` + `_meta`
 * (`{ caption, sourceHost }`).
 *
 * A field that is not declared here is **silently stripped at this boundary** — the exact
 * failure mode this repo hit twice (decode looks right, data never reaches chat-ui). So these
 * tests assert the new fields actually arrive, and that legacy images keep parsing.
 */

import { describe, expect, it } from 'vitest';
import { historyPageSchema } from '#runtimes/acp/api/schemas';
import { transcriptMessageSchema } from './messages';

const legacyImage = { mimeType: 'image/png', data: 'QUJD' };

const carriedImage = {
  ...legacyImage,
  uri: 'https://x.test/poster-design',
  caption: '极简留白海报',
  sourceHost: 'x.test',
};

function messageWith(images: unknown): Record<string, unknown> {
  return {
    kind: 'message',
    id: 'conv-1:turn:0:assistant:0',
    seq: 0,
    role: 'assistant',
    text: '',
    images,
  };
}

function pageWith(item: Record<string, unknown>) {
  return {
    turns: [
      {
        id: 'conv-1:turn:0',
        seq: 0,
        initiator: 'agent',
        items: [item],
      },
    ],
    nextCursor: null,
  };
}

describe('transcriptMessageSchema — image metadata', () => {
  it('keeps uri + caption + sourceHost on an image block', () => {
    const parsed = transcriptMessageSchema.parse(messageWith([carriedImage]));
    expect(parsed.images).toEqual([carriedImage]);
  });

  it('still parses legacy images that only carry mimeType + data', () => {
    const parsed = transcriptMessageSchema.parse(messageWith([legacyImage]));
    expect(parsed.images).toEqual([legacyImage]);
  });

  it('keeps a local absolute-path uri verbatim (local image-library hits)', () => {
    const parsed = transcriptMessageSchema.parse(
      messageWith([{ ...legacyImage, uri: '/media/lib/样本龙领去.jpg', caption: '样本龙领去.jpg' }])
    );
    expect(parsed.images?.[0]).toMatchObject({
      uri: '/media/lib/样本龙领去.jpg',
      caption: '样本龙领去.jpg',
    });
  });

  it('rejects a non-string caption (the schema is strict; decoding already filters)', () => {
    expect(
      transcriptMessageSchema.safeParse(messageWith([{ ...legacyImage, caption: { text: 'x' } }]))
        .success
    ).toBe(false);
  });
});

describe('historyPageSchema — image metadata survives the wire', () => {
  it('round-trips uri/caption/sourceHost instead of stripping them', () => {
    const parsed = historyPageSchema.parse(pageWith(messageWith([carriedImage])));
    const items = parsed.turns[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'message', images: [carriedImage] });
  });
});
