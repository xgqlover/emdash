import { z } from 'zod';
import { attachmentMetadataSchema } from '#services/attachments/api';

export const transcriptMessageSchema = z.object({
  kind: z.literal('message'),
  /** Opaque reducer-owned identity, scoped to the turn, role, and identity origin. */
  id: z.string(),
  /** Stable order within the owning turn, assigned once by the reducer. */
  seq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  /** Correlates an accepted prompt without matching message text. */
  promptId: z.string().optional(),
  text: z.string(),
  /** Attachment metadata only; bytes are served separately by the runtime. */
  attachments: z.array(attachmentMetadataSchema).optional(),
  /**
   * [XG-CUSTOM 2026-10-09] Agent-sent inline images (bare base64, no data-URL
   * prefix). Kept `optional()` so transcripts/records written before this field
   * existed still parse. Only agents populate it (user prompts use `attachments`).
   *
   * [XG-CUSTOM 2026-10-10] `uri` / `caption` / `sourceHost` mirror ACP's native
   * `ImageContent.uri` + `_meta` (`{ caption, sourceHost }`) and replace the custom
   * `[XG-IMG-META]` marker. All three are `optional()` **and must stay declared**:
   * an undeclared field is stripped by zod at this wire boundary (the exact failure
   * mode this repo hit twice before — the event layer would look correct and the
   * data would silently never reach chat-ui).
   */
  images: z
    .array(
      z.object({
        mimeType: z.string(),
        data: z.string(),
        uri: z.string().optional(),
        caption: z.string().optional(),
        sourceHost: z.string().optional(),
      })
    )
    .optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;
