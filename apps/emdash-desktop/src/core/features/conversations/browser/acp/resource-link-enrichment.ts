/**
 * [XG-CUSTOM 2026-10-10] Desktop enrichment for ACP-native `resource_link` rows.
 *
 * The ACP runtime decodes `resource_link` content blocks into transcript items
 * carrying the raw `uri`, but it cannot know how *this* client can address that
 * URI (workspace file vs. browser URL vs. a scheme it cannot resolve). chat-ui's
 * `ChatResourceLink` therefore expects a pre-resolved `target`; this module is
 * that missing transform.
 *
 * It runs on every page that reaches the chat-ui transcript store, so live
 * updates and paginated history are covered by the same code path. It is
 * idempotent: items that already carry a target are returned by reference.
 */

import type {
  HistoryPage,
  ResourceTarget,
  TranscriptItem,
} from '@emdash/core/runtimes/acp/api/client';

const HTTP_URI = /^https?:\/\//i;
const FILE_URI = /^file:\/\//i;

/** Percent-decoding that never throws (malformed escapes are kept verbatim). */
function decodePercent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `file://` URI -> local path.
 *
 * `file:///media/x.jpg` -> `/media/x.jpg` (percent escapes decoded, so Chinese
 * paths such as `%E6%A0%B7%E6%9C%AC.jpg` resolve correctly).
 * Returns null for an authority we cannot map to a local path (`file://host/share`),
 * which the caller degrades to `opaque` rather than inventing a path.
 */
export function fileUriToPath(uri: string): string | null {
  const rest = uri.replace(FILE_URI, '');
  if (rest.startsWith('/')) return decodePercent(rest);
  if (/^localhost\//i.test(rest)) return decodePercent(`/${rest.slice('localhost/'.length)}`);
  return null;
}

/**
 * Resolve an ACP resource URI into the target the chat-ui row understands.
 *
 * - `http(s)://` -> external (opened in a new tab)
 * - `file://` or an absolute POSIX path -> workspace-file (opened in the editor).
 *   Absolute paths are the common case for the 项我 bridge: local image-library
 *   hits have no source page and arrive as `/media/...`.
 * - anything else -> opaque (shown for copy, not clickable)
 */
export function resolveResourceTarget(uri: string): ResourceTarget {
  const raw = (uri ?? '').trim();
  if (HTTP_URI.test(raw)) return { kind: 'external', url: raw };
  if (FILE_URI.test(raw)) {
    const path = fileUriToPath(raw);
    return path === null ? { kind: 'opaque' } : { kind: 'workspace-file', path };
  }
  if (raw.startsWith('/')) return { kind: 'workspace-file', path: raw };
  return { kind: 'opaque' };
}

/**
 * Fill in `target` for every resource-link item in a history page. Other item
 * kinds and already-resolved links pass through untouched (stable references are
 * preserved so identity-keyed caches keep working).
 */
export function enrichResourceLinks(page: HistoryPage): HistoryPage {
  let pageChanged = false;
  const turns = page.turns.map((turn) => {
    let turnChanged = false;
    const items = turn.items.map((item): TranscriptItem => {
      if (item.kind !== 'resource-link' || item.target) return item;
      turnChanged = true;
      return { ...item, target: resolveResourceTarget(item.uri) };
    });
    if (!turnChanged) return turn;
    pageChanged = true;
    return { ...turn, items };
  });
  return pageChanged ? { ...page, turns } : page;
}
