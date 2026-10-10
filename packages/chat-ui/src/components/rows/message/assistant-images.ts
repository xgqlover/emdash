// [XG-CUSTOM 2026-10-09] Agent-sent image cards for assistant messages.
//
// Protocol (bridge side: xiangwo_acp.py / agent.py; 项我球 reference:
// apps/emdash-desktop/src/renderer/orb/xiangwo-images.ts — caption = alt||source,
// corner badge = host(page), click opens `page`):
//
//   per turn the bridge emits
//     1. the body text chunk (may be skipped by streaming de-dup),
//     2. ONE text chunk `[XG-IMG-META][{"alt":…,"source":…,"page":…}, …][/XG-IMG-META]`,
//     3. N `agent_message_chunk`s with `content = { type: 'image', … }`,
//        in the same order as the metadata array.
//
// So the metadata and the images normally arrive in *different* chunks (and the
// marker may even be absent). Everything here is therefore best-effort and must
// never throw: a broken marker, a missing field, or fewer images than metadata
// entries only degrade the card — they never break the message.
//
// Text handling: the marker is **always** stripped (it is machine data the user
// must never see), even when its JSON is unusable.

import type { ChatMessageImage } from '@/model';

/** `[XG-IMG-META]<json>[/XG-IMG-META]` — one per turn. Built per call (no shared /g state). */
const XG_IMG_META_SOURCE = '\\[XG-IMG-META\\]([\\s\\S]*?)\\[/XG-IMG-META\\]';

/** Geometry of one image cell. Kept in sync with `assistant-images.css.ts`. */
export const ASSISTANT_IMAGE_THUMB = 148;
export const ASSISTANT_IMAGE_CAPTION = 18;
export const ASSISTANT_IMAGE_GAP = 8;

/** One metadata entry as sent by the bridge (all fields optional / may be junk). */
export type AssistantImageMeta = {
  alt: string;
  source: string;
  page: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 0): string {
  const result = typeof value === 'string' ? value.trim() : '';
  return max > 0 ? result.slice(0, max) : result;
}

/** Host of an http(s) URL; '' when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Only http(s) pages are clickable — never open agent-local paths from a card. */
export function isOpenablePage(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Split the metadata marker out of an assistant message's text.
 *
 * The marker is stripped **unconditionally**; `meta` is only populated when the
 * payload is a JSON array. Any malformed entry degrades to empty strings.
 */
export function splitAssistantImageMeta(textValue: unknown): {
  text: string;
  meta: AssistantImageMeta[];
} {
  const source = typeof textValue === 'string' ? textValue : '';
  const re = new RegExp(XG_IMG_META_SOURCE, 'g');
  const meta: AssistantImageMeta[] = [];
  for (const match of source.matchAll(re)) {
    const raw = (match[1] ?? '').trim();
    if (raw === '') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const item = asRecord(entry);
        meta.push({
          alt: text(item.alt, 200),
          source: text(item.source, 80),
          page: text(item.page),
        });
      }
    } catch {
      // Broken JSON: the marker is still stripped above — nothing else to do.
    }
  }
  return { text: source.replace(re, '').trim(), meta };
}

/** Base64 payload -> `data:` URL for `<img src>`. Unknown/empty MIME falls back to PNG. */
export function assistantImageDataUrl(image: Pick<ChatMessageImage, 'mimeType' | 'data'>): string {
  const mime = text(image.mimeType) || 'image/png';
  return `data:${mime};base64,${image.data}`;
}

/**
 * Pair raw image blocks with the metadata array by index (`min(len)`), mirroring
 * the orb's caption/badge rules. Extra metadata entries are ignored; missing ones
 * only cost the caption.
 */
export function buildAssistantImages(
  itemId: string,
  images: ReadonlyArray<Pick<ChatMessageImage, 'mimeType' | 'data'>>,
  meta: ReadonlyArray<AssistantImageMeta>
): ChatMessageImage[] {
  return images.map((image, index) => {
    const entry = meta[index];
    const alt = entry?.alt ?? '';
    const source = entry?.source ?? '';
    const page = entry?.page ?? '';
    const caption = alt !== '' ? alt : source;
    const badge = hostOf(page) !== '' ? hostOf(page) : source;
    const openable = isOpenablePage(page);
    return {
      id: `${itemId}#img${index}`,
      mimeType: image.mimeType,
      data: image.data,
      ...(caption !== '' ? { caption } : {}),
      ...(openable ? { page } : {}),
      ...(badge !== '' ? { sourceHost: badge } : {}),
    };
  });
}

/** Images per grid row for the given available width (>= 1). */
export function assistantImagesPerRow(width: number): number {
  const usable = Math.max(0, width);
  return Math.max(
    1,
    Math.floor((usable + ASSISTANT_IMAGE_GAP) / (ASSISTANT_IMAGE_THUMB + ASSISTANT_IMAGE_GAP))
  );
}

/**
 * Exact height consumed by the image grid (including the gap that separates it
 * from the footer). Must match the rendered CSS box-for-box: every cell reserves
 * a fixed thumb square plus a single caption line, so wrapping is deterministic
 * and the virtualizer's measurement stays correct.
 */
export function assistantImageGridHeight(count: number, width: number): number {
  if (count <= 0) return 0;
  const perRow = assistantImagesPerRow(width);
  const rows = Math.ceil(count / perRow);
  const cell = ASSISTANT_IMAGE_THUMB + ASSISTANT_IMAGE_CAPTION;
  return rows * cell + (rows - 1) * ASSISTANT_IMAGE_GAP + ASSISTANT_IMAGE_GAP;
}
