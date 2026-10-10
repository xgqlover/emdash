/**
 * [XG-CUSTOM 2026-10-10] Schema tests for ACP-native `resource_link` rows.
 *
 * The point of these tests is the **wire boundary**: `historyPageSchema` (=
 * `transcriptTurnSchema` -> `transcriptItemSchema`) is what the runtime parses
 * history through. Before `resource-link` was added to the union, zod would have
 * silently stripped the whole item — a row that "decodes fine" but never arrives.
 */

import { describe, expect, it } from 'vitest';
import { historyPageSchema } from '#runtimes/acp/api/schemas';
import { transcriptItemSchema } from './turn';

const bareLink = {
  kind: 'resource-link',
  id: 'conv-1:turn:0:resource-link:0',
  seq: 1,
  uri: '/media/lib/样本龙领去.jpg',
  name: '样本龙领去.jpg',
};

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

describe('transcriptResourceLinkSchema', () => {
  it('parses a bare row (only the ACP-required fields) and leaves target unset', () => {
    const parsed = transcriptItemSchema.parse(bareLink);
    expect(parsed).toEqual(bareLink);
    if (parsed.kind !== 'resource-link') throw new Error('expected a resource-link item');
    expect(parsed.target).toBeUndefined();
  });

  it('keeps every optional ACP field, including size', () => {
    const parsed = transcriptItemSchema.parse({
      ...bareLink,
      title: '样本龙领去',
      description: 'pixelrag',
      mimeType: 'image/jpeg',
      size: 20480,
    });
    expect(parsed).toMatchObject({
      title: '样本龙领去',
      description: 'pixelrag',
      mimeType: 'image/jpeg',
      size: 20480,
    });
  });

  it('accepts a desktop-enriched row (target present) — the same object satisfies both sides', () => {
    const parsed = transcriptItemSchema.parse({
      ...bareLink,
      target: { kind: 'workspace-file', path: '/media/lib/样本龙领去.jpg' },
    });
    if (parsed.kind !== 'resource-link') throw new Error('expected a resource-link item');
    expect(parsed.target).toEqual({ kind: 'workspace-file', path: '/media/lib/样本龙领去.jpg' });
  });

  it('rejects an unknown target kind (discriminated union is enforced)', () => {
    expect(
      transcriptItemSchema.safeParse({ ...bareLink, target: { kind: 'nope', path: '/x' } }).success
    ).toBe(false);
  });

  it('requires uri, name, id and seq', () => {
    for (const missing of ['uri', 'name', 'id', 'seq'] as const) {
      const item: Record<string, unknown> = { ...bareLink };
      delete item[missing];
      expect(transcriptItemSchema.safeParse(item).success).toBe(false);
    }
  });
});

describe('historyPageSchema — the resource link survives the wire', () => {
  it('round-trips a resource-link item instead of stripping it', () => {
    const parsed = historyPageSchema.parse(
      pageWith({ ...bareLink, target: { kind: 'external', url: 'https://x.test/poster' } })
    );
    const items = parsed.turns[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'resource-link',
      uri: '/media/lib/样本龙领去.jpg',
      name: '样本龙领去.jpg',
      target: { kind: 'external', url: 'https://x.test/poster' },
    });
  });
});
