// [XG-CUSTOM 2026-10-09] Agent-sent image cards for assistant messages.
//
// Protocol (bridge side: xiangwo_acp.py / agent.py; 项我球 reference:
// apps/emdash-desktop/src/renderer/orb/xiangwo-images.ts — caption = alt||source,
// corner badge = host(page), click opens the source page):
//
//   [XG-CUSTOM 2026-10-10] **Preferred (current) shape** — everything the card needs
//   rides on the image block itself, using ACP's native fields:
//     N `agent_message_chunk`s with `content = { type: 'image', data, mimeType,
//       uri: '<source page http(s) | local absolute path>',
//       _meta: { caption, sourceHost } }`
//
//   **Legacy shape (still supported)** — one text chunk carrying
//   `[XG-IMG-META][{alt,source,page}, …][/XG-IMG-META]`, paired with the images by index.
//   Old sessions and old bridges keep working; the marker is **always** stripped from
//   the visible text (it is machine data the user must never see), even when its JSON
//   is broken or unusable.
//
// Everything here is best-effort and must never throw: a broken marker, a missing
// field, or fewer metadata entries than images only degrade the card.
//
// [XG-CUSTOM 2026-10-10] **协议与语义现在只有一份** —— `@emdash/shared` 的
// `packages/shared/src/xiangwo-images.ts`（球面 `renderer/orb/xiangwo-images.ts` 也用它）。
// 本文件只保留**主窗专属**的东西：虚拟列表的格子几何 + base64 → data URL + 按位配对。
// 下面这些 `export` 是**兼容面**（`assistant-images.test.ts` 与 `message.def.tsx` 都从本模块取），
// 一律保持名字与行为不变。

import { badgeOf, captionOf, isHttpUrl, text } from '@emdash/shared';
import type { ChatMessageImage } from '@/model';

// [XG-CUSTOM 2026-10-10] `hostOf` 与 marker 解析都改由共享份提供（**保持导出面**：测试在用）。
export { hostOf } from '@emdash/shared';
export { splitXiangwoImageMeta as splitAssistantImageMeta } from '@emdash/shared';

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

// [XG-CUSTOM 2026-10-10] 原来的 `asRecord` / `text` / `hostOf` 已搬到 `@emdash/shared`
// （`text` 仍然从这里 import，供 base64 → data URL 用）。

/** Only http(s) pages are clickable — never open agent-local paths from a card. */
export function isOpenablePage(url: string): boolean {
  // [XG-CUSTOM 2026-10-10] 与共享份同一个口径（`isHttpUrl`）；行为与原来逐字一致。
  return isHttpUrl(url);
}

/** Base64 payload -> `data:` URL for `<img src>`. Unknown/empty MIME falls back to PNG. */
export function assistantImageDataUrl(image: Pick<ChatMessageImage, 'mimeType' | 'data'>): string {
  const mime = text(image.mimeType) || 'image/png';
  return `data:${mime};base64,${image.data}`;
}

/** One image block as delivered (new contract carries `uri` + `_meta`-derived fields). */
export type AssistantImageInput = Pick<ChatMessageImage, 'mimeType' | 'data'> &
  Partial<Pick<ChatMessageImage, 'uri' | 'caption' | 'sourceHost'>>;

/** [XG-CUSTOM 2026-10-10] Where clicking a card leads. Mirrors the app-layer resource resolver. */
export type AssistantImageTarget =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'none' };

/** `file:///a/b.jpg` -> `/a/b.jpg` (percent-decoded). A real authority (`file://host/share`) stays unmapped. */
export function fileUrlToPath(url: string): string {
  const rest = text(url).replace(/^file:\/\//i, '');
  const local = rest.startsWith('/')
    ? rest
    : /^localhost\//i.test(rest)
      ? `/${rest.slice('localhost/'.length)}`
      : '';
  if (local === '') return '';
  try {
    return decodeURIComponent(local);
  } catch {
    return local;
  }
}

/**
 * [XG-CUSTOM 2026-10-10] Resolve a card's click target from the delivered URI, using the
 * **same split** as `resource_link` rows: `http(s)` -> new tab, absolute path or `file://`
 * -> editor, anything else -> inert. Never throws.
 *
 * A path containing `?` is treated as inert on purpose: the agent also hands out
 * *relative proxy* addresses like `/xg/img?u=…`, which start with `/` but are **not**
 * files on disk. Only bare absolute paths (the bridge's local-library case) open in the
 * editor — this keeps the pre-existing "never open an agent-relative URL" invariant.
 */
export function assistantImageTarget(raw: string): AssistantImageTarget {
  const value = text(raw);
  if (value === '') return { kind: 'none' };
  if (isHttpUrl(value)) return { kind: 'external', url: value };
  if (value.toLowerCase().startsWith('file://')) {
    const path = fileUrlToPath(value);
    return path === '' ? { kind: 'none' } : { kind: 'file', path };
  }
  // Absolute POSIX path — the common case for local image-library hits (e.g. /media/...).
  if (value.startsWith('/') && !value.includes('?')) return { kind: 'file', path: value };
  return { kind: 'none' };
}

/**
 * Pair raw image blocks with the metadata array by index (`min(len)`), mirroring
 * the orb's caption/badge rules. Extra metadata entries are ignored; missing ones
 * only cost the caption.
 *
 * [XG-CUSTOM 2026-10-10] Fields carried **on the image** (ACP `uri` + `_meta`) win; the
 * legacy `[XG-IMG-META]` entry for the same index is the fallback, so old records and
 * old bridges render exactly as before.
 */
export function buildAssistantImages(
  itemId: string,
  images: ReadonlyArray<AssistantImageInput>,
  meta: ReadonlyArray<AssistantImageMeta>
): ChatMessageImage[] {
  return images.map((image, index) => {
    const entry = meta[index];
    const alt = entry?.alt ?? '';
    const source = entry?.source ?? '';
    const page = entry?.page ?? '';
    // [XG-CUSTOM 2026-10-10] 小字 / 角标用**共享语义**（球面同一个口径）；自带字段优先。
    const carried = text(image.uri);
    const caption = text(image.caption) || captionOf({ alt, source });
    const badge =
      text(image.sourceHost) || badgeOf({ page: carried !== '' ? carried : page, source });
    // 点击目标：自带 `uri` 优先（可为 http 或本机路径）；legacy marker 的 `page` 仅 http 可点（老行为不变）。
    const target = carried !== '' ? carried : isOpenablePage(page) ? page : '';
    return {
      id: `${itemId}#img${index}`,
      mimeType: image.mimeType,
      data: image.data,
      ...(caption !== '' ? { caption } : {}),
      ...(target !== '' ? { uri: target } : {}),
      // 兼容面：`page` 仍然只在 http(s) 时出现（老的消费者与测试按这个口径）。
      ...(isOpenablePage(target) ? { page: target } : {}),
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
