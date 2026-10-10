import { z } from 'zod';

/**
 * [XG-CUSTOM 2026-10-10] ACP-native `resource_link` rows.
 *
 * Upstream already ships the protocol content block (`ContentBlock` member
 * `resource_link`, see `@agentclientprotocol/sdk` `ResourceLink`: required
 * `uri` + `name`, optional `title` / `description` / `mimeType` / `size`) and a
 * chat-ui row (`ChatResourceLink` + `components/rows/resource-link`), but no
 * producer was ever wired up. This schema is the transcript/wire half of that
 * missing producer.
 *
 * `target` is the **desktop-resolved** addressing target. It stays optional here
 * because the core runtime cannot know the client's workspace: the desktop
 * enrichment transform resolves `uri` -> `target` before the item is handed to
 * chat-ui. Keeping it on the same object (instead of a second, chat-ui-only
 * type) means the enriched item still satisfies this schema — no casts.
 */
export const resourceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace-file'), path: z.string() }),
  z.object({ kind: z.literal('external'), url: z.string() }),
  z.object({ kind: z.literal('opaque') }),
]);
export type ResourceTarget = z.infer<typeof resourceTargetSchema>;

export const transcriptResourceLinkSchema = z.object({
  kind: z.literal('resource-link'),
  /** Opaque reducer-owned identity, scoped to the turn (see `makeResourceLinkId`). */
  id: z.string(),
  /** Stable order within the owning turn, assigned once by the reducer. */
  seq: z.number().int(),
  /** Original ACP URI, preserved verbatim for display and copy. */
  uri: z.string(),
  /** Required resource name as sent by ACP. */
  name: z.string(),
  /** Optional human-friendly label; preferred over `name` when present. */
  title: z.string().optional(),
  /** Optional one-line description. */
  description: z.string().optional(),
  /** MIME type hint; drives the file-type icon. */
  mimeType: z.string().optional(),
  /** Size of the linked resource in bytes, when known. */
  size: z.number().optional(),
  /**
   * Pre-resolved addressing target. Absent on the wire (the runtime cannot
   * resolve it); filled in by the desktop enrichment transform.
   */
  target: resourceTargetSchema.optional(),
});
export type TranscriptResourceLink = z.infer<typeof transcriptResourceLinkSchema>;
