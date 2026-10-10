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
    // [XG-CUSTOM 2026-10-10] 小字 / 角标改用**共享语义**（球面同一个口径），别再各写一份。
    const caption = captionOf({ alt, source });
    const badge = badgeOf({ page, source });
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
