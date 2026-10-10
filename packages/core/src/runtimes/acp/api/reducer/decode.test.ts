/**
 * [XG-CUSTOM 2026-10-09] Decoder + fold tests for agent-sent inline images.
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
import type { TranscriptMessage } from '../models/turns';
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
