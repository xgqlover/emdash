/**
 * [XG-CUSTOM 2026-10-09] Decoder + fold tests for agent-sent inline images.
 * [XG-CUSTOM 2026-10-10] …and for ACP-native `resource_link` blocks (sub-artifacts).
 *
 * The 项我 (xiangwo) bridge emits, per turn:
 *   1. the body text chunk (may be skipped by streaming de-dup),
 *   2. ONE text chunk carrying `[XG-IMG-META][…][/XG-IMG-META]`,
 *   3. N `agent_message_chunk` updates with `content = { type: 'image', … }`,
 *      in the same order as the metadata array.
 *
 * Before this change step 3 was silently dropped by the decoder
 * (`content.type !== 'text'` -> ignored), so generated images never rendered.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { TranscriptMessage, TranscriptResourceLink } from '../models/turns';
import { decodeSessionUpdate } from './decode';
import { AcpTranscriptParser } from './parser';

function textChunk(messageId: string | null, text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    sessionId: 'sess-1',
    messageId,
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

function imageChunk(messageId: string | null, mimeType: string, data: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    sessionId: 'sess-1',
    messageId,
    content: { type: 'image', mimeType, data },
  } as unknown as SessionUpdate;
}

function messagesOf(parser: AcpTranscriptParser): TranscriptMessage[] {
  const turns = [...parser.history, ...(parser.activeTurn ? [parser.activeTurn] : [])];
  return turns.flatMap((turn) =>
    turn.items.filter((item): item is TranscriptMessage => item.kind === 'message')
  );
}

describe('decodeSessionUpdate — agent image blocks', () => {
  it('decodes an image content block into a text-less assistant message', () => {
    const event = decodeSessionUpdate(imageChunk('m1', 'image/webp', 'QUJD'));
    expect(event).toEqual({
      kind: 'message',
      role: 'assistant',
      messageId: 'm1',
      text: '',
      images: [{ mimeType: 'image/webp', data: 'QUJD' }],
    });
  });

  it('ignores an image block with an empty payload', () => {
    expect(decodeSessionUpdate(imageChunk('m1', 'image/png', ''))).toEqual({ kind: 'ignored' });
  });

  it('still ignores non-text, non-image blocks (audio untouched)', () => {
    const audio = {
      sessionUpdate: 'agent_message_chunk',
      sessionId: 'sess-1',
      messageId: 'm1',
      content: { type: 'audio', mimeType: 'audio/wav', data: 'QUJD' },
    } as unknown as SessionUpdate;
    expect(decodeSessionUpdate(audio)).toEqual({ kind: 'ignored' });
  });

  it('leaves the text branch unchanged', () => {
    expect(decodeSessionUpdate(textChunk('m1', 'hello'))).toEqual({
      kind: 'message',
      role: 'assistant',
      messageId: 'm1',
      text: 'hello',
    });
  });
});

describe('foldItem — image chunks ride the turn’s assistant message', () => {
  it('folds text + meta + images with null messageIds into ONE assistant message', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    parser.push(textChunk(null, '图来了：'));
    parser.push(
      textChunk(null, '[XG-IMG-META][{"alt":"a","page":"https://x.test/p"}][/XG-IMG-META]')
    );
    parser.push(imageChunk(null, 'image/png', 'AAA'));
    parser.push(imageChunk(null, 'image/jpeg', 'BBB'));

    const messages = messagesOf(parser);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(
      '图来了：[XG-IMG-META][{"alt":"a","page":"https://x.test/p"}][/XG-IMG-META]'
    );
    expect(messages[0]?.images).toEqual([
      { mimeType: 'image/png', data: 'AAA' },
      { mimeType: 'image/jpeg', data: 'BBB' },
    ]);
  });

  it('attaches a body-less image chunk to the LAST assistant message (different messageId)', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    parser.push(textChunk('body-1', '正文'));
    parser.push(imageChunk('img-only-9', 'image/png', 'AAA'));

    const messages = messagesOf(parser);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('正文');
    expect(messages[0]?.images).toEqual([{ mimeType: 'image/png', data: 'AAA' }]);
  });

  it('still opens an assistant bubble when the turn starts with an image', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    parser.push(imageChunk(null, 'image/png', 'AAA'));

    const messages = messagesOf(parser);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('assistant');
    expect(messages[0]?.text).toBe('');
    expect(messages[0]?.images).toEqual([{ mimeType: 'image/png', data: 'AAA' }]);
  });

  it('caps accumulated images per message (memory guard, bridge sends <= 24)', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    for (let i = 0; i < 70; i += 1) parser.push(imageChunk(null, 'image/png', `IMG${i}`));

    const messages = messagesOf(parser);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.images).toHaveLength(60);
    expect(messages[0]?.images?.[0]?.data).toBe('IMG0');
  });
});

function resourceLinkChunk(fields: Record<string, unknown>): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    sessionId: 'sess-1',
    content: { type: 'resource_link', ...fields },
  } as unknown as SessionUpdate;
}

function resourceLinksOf(parser: AcpTranscriptParser): TranscriptResourceLink[] {
  const turns = [...parser.history, ...(parser.activeTurn ? [parser.activeTurn] : [])];
  return turns.flatMap((turn) =>
    turn.items.filter((item): item is TranscriptResourceLink => item.kind === 'resource-link')
  );
}

describe('decodeSessionUpdate — ACP resource_link blocks', () => {
  it('decodes a resource_link block into its own event', () => {
    expect(
      decodeSessionUpdate(resourceLinkChunk({ uri: 'https://x.test/poster', name: '海报参考' }))
    ).toEqual({ kind: 'resource_link', uri: 'https://x.test/poster', name: '海报参考' });
  });

  it('carries title/description/mimeType/size when ACP sent them', () => {
    expect(
      decodeSessionUpdate(
        resourceLinkChunk({
          uri: '/media/lib/样本龙领去.jpg',
          name: '样本龙领去.jpg',
          title: '样本龙领去',
          description: 'pixelrag',
          mimeType: 'image/jpeg',
          size: 20480,
        })
      )
    ).toEqual({
      kind: 'resource_link',
      uri: '/media/lib/样本龙领去.jpg',
      name: '样本龙领去.jpg',
      title: '样本龙领去',
      description: 'pixelrag',
      mimeType: 'image/jpeg',
      size: 20480,
    });
  });

  it('drops empty optional fields instead of emitting blank strings', () => {
    const event = decodeSessionUpdate(
      resourceLinkChunk({ uri: 'https://x.test/a', name: 'a', title: '  ', description: null })
    );
    expect(event).toEqual({ kind: 'resource_link', uri: 'https://x.test/a', name: 'a' });
  });

  it('ignores a block missing uri or name (never a half-built row)', () => {
    expect(decodeSessionUpdate(resourceLinkChunk({ name: 'only-name' }))).toEqual({
      kind: 'ignored',
    });
    expect(decodeSessionUpdate(resourceLinkChunk({ uri: 'https://x.test/a' }))).toEqual({
      kind: 'ignored',
    });
    expect(decodeSessionUpdate(resourceLinkChunk({ uri: '   ', name: '  ' }))).toEqual({
      kind: 'ignored',
    });
  });
});

describe('foldItem — resource links are standalone rows', () => {
  it('creates one row per block and never merges them into the message bubble', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    parser.push(textChunk(null, '参考：'));
    parser.push(resourceLinkChunk({ uri: 'https://x.test/poster', name: '海报参考' }));
    parser.push(
      resourceLinkChunk({ uri: '/media/lib/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' })
    );
    parser.push(textChunk(null, '完'));

    // The link is foreground content, so it *splits* the surrounding message
    // (upstream `materializeEvent` closes the content segment) — that is exactly
    // the "standalone row, split from the surrounding message" contract.
    const turn = parser.activeTurn;
    expect(turn?.items.map((item) => item.kind)).toEqual([
      'message',
      'resource-link',
      'resource-link',
      'message',
    ]);
    const messages = messagesOf(parser);
    expect(messages.map((message) => message.text)).toEqual(['参考：', '完']);
    expect(messages.some((message) => message.text.includes('x.test'))).toBe(false);

    const links = resourceLinksOf(parser);
    expect(links.map((link) => link.uri)).toEqual(['https://x.test/poster', '/media/lib/a.jpg']);
    expect(links.map((link) => link.seq)).toEqual([1, 2]);
    expect(links.map((link) => link.id)).toEqual([
      'conv-1:turn:0:resource-link:0',
      'conv-1:turn:0:resource-link:1',
    ]);
    // The desktop enrichment fills this in; the runtime leaves it unset.
    expect(links.every((link) => link.target === undefined)).toBe(true);
  });

  it('opens a turn for a link that arrives on its own', () => {
    const parser = new AcpTranscriptParser({ conversationId: 'conv-1' });
    parser.push(resourceLinkChunk({ uri: 'https://x.test/only', name: 'only' }));

    expect(parser.activeTurn?.initiator).toBe('agent');
    expect(resourceLinksOf(parser)).toHaveLength(1);
  });
});
