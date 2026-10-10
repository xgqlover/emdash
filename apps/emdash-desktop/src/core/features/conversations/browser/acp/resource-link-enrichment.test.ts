/**
 * [XG-CUSTOM 2026-10-10] Tests for the desktop `resource_link` enrichment.
 *
 * Covers the three URI classes the 项我 bridge actually produces — a real source
 * page (`https://…`) and, most commonly, a bare absolute path into the local
 * image library (`/media/…`), plus `file://` forms with percent escapes for
 * Chinese paths.
 */

import type { HistoryPage, TranscriptItem } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import {
  enrichResourceLinks,
  fileUriToPath,
  resolveResourceTarget,
} from './resource-link-enrichment';

function link(uri: string, extra: Record<string, unknown> = {}): TranscriptItem {
  return {
    kind: 'resource-link',
    id: `conv-1:turn:0:resource-link:${uri.length}`,
    seq: 1,
    uri,
    name: 'name',
    ...extra,
  } as TranscriptItem;
}

function page(items: TranscriptItem[]): HistoryPage {
  return {
    turns: [{ id: 'conv-1:turn:0', seq: 0, initiator: 'agent', items }],
    nextCursor: null,
  } as HistoryPage;
}

describe('resolveResourceTarget', () => {
  it('maps http(s) URIs to external', () => {
    expect(resolveResourceTarget('https://www.pexels.com/photo/x-1/')).toEqual({
      kind: 'external',
      url: 'https://www.pexels.com/photo/x-1/',
    });
    expect(resolveResourceTarget('http://example.com/a')).toEqual({
      kind: 'external',
      url: 'http://example.com/a',
    });
  });

  it('maps an absolute POSIX path to workspace-file (the common bridge case)', () => {
    expect(resolveResourceTarget('/media/xgqlover/pixelrag-data/样本龙领去.jpg')).toEqual({
      kind: 'workspace-file',
      path: '/media/xgqlover/pixelrag-data/样本龙领去.jpg',
    });
  });

  it('maps file:// URIs to workspace-file with percent escapes decoded', () => {
    expect(resolveResourceTarget('file:///media/lib/%E6%A0%B7%E6%9C%AC.jpg')).toEqual({
      kind: 'workspace-file',
      path: '/media/lib/样本.jpg',
    });
    expect(resolveResourceTarget('file://localhost/media/lib/a.png')).toEqual({
      kind: 'workspace-file',
      path: '/media/lib/a.png',
    });
  });

  it('degrades an unmappable file authority and unknown schemes to opaque', () => {
    expect(resolveResourceTarget('file://fileserver/share/a.png')).toEqual({ kind: 'opaque' });
    expect(resolveResourceTarget('memory://kb/123')).toEqual({ kind: 'opaque' });
    expect(resolveResourceTarget('')).toEqual({ kind: 'opaque' });
  });

  it('trims surrounding whitespace', () => {
    expect(resolveResourceTarget('  https://x.test/a  ')).toEqual({
      kind: 'external',
      url: 'https://x.test/a',
    });
  });
});

describe('fileUriToPath', () => {
  it('keeps a malformed percent escape verbatim instead of throwing', () => {
    expect(fileUriToPath('file:///media/100%/a.jpg')).toBe('/media/100%/a.jpg');
  });
});

describe('enrichResourceLinks', () => {
  it('fills target for every resource link and preserves item order', () => {
    const enriched = enrichResourceLinks(
      page([link('https://x.test/poster'), link('/media/lib/a.jpg'), link('memory://kb/1')])
    );
    const items = enriched.turns[0]?.items ?? [];
    expect(items.map((item) => item.kind)).toEqual([
      'resource-link',
      'resource-link',
      'resource-link',
    ]);
    expect(items.map((item) => (item.kind === 'resource-link' ? item.target : null))).toEqual([
      { kind: 'external', url: 'https://x.test/poster' },
      { kind: 'workspace-file', path: '/media/lib/a.jpg' },
      { kind: 'opaque' },
    ]);
  });

  it('is idempotent: an already-resolved link keeps its target and reference', () => {
    const resolved = link('/media/lib/a.jpg', {
      target: { kind: 'external', url: 'https://kept.example/a' },
    });
    const enriched = enrichResourceLinks(page([resolved]));
    expect(enriched.turns[0]?.items[0]).toBe(resolved);
  });

  it('returns the same page object when there is nothing to resolve', () => {
    const original = page([
      {
        kind: 'message',
        id: 'conv-1:turn:0:message:assistant:generated:0',
        seq: 0,
        role: 'assistant',
        text: '没有链接',
      } as TranscriptItem,
    ]);
    expect(enrichResourceLinks(original)).toBe(original);
  });

  it('leaves non-resource items untouched by reference', () => {
    const message = {
      kind: 'message',
      id: 'conv-1:turn:0:message:assistant:generated:0',
      seq: 0,
      role: 'assistant',
      text: '参考：',
    } as TranscriptItem;
    const enriched = enrichResourceLinks(page([message, link('/media/lib/a.jpg')]));
    expect(enriched.turns[0]?.items[0]).toBe(message);
  });
});
