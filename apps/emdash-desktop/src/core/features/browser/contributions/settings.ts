import { z } from 'zod';
import type { BrowserSettings } from '@core/primitives/app-settings/api';
import {
  BROWSER_ISOLATED_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILES,
} from '@core/primitives/browser/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const browserProfileIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .refine((value) => value !== BROWSER_ISOLATED_PROFILE_ID);

// [XG-CUSTOM] botId：与 xiangwo-agent 的 suagent/role id 同形（如 sxsj / chief-engineer）
const browserBotIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const browserSettingsSchema = z
  .object({
    defaultProfileId: z.union([browserProfileIdSchema, z.literal(BROWSER_ISOLATED_PROFILE_ID)]),
    relaxCorsForLocalhost: z.boolean(),
    profiles: z
      .array(
        z.object({
          id: browserProfileIdSchema,
          name: z.string().trim().min(1).max(40),
          // [XG-CUSTOM] 可选：这个 profile 属于哪个 bot（1:1，见下方 refine）
          botId: browserBotIdSchema.optional(),
        })
      )
      .min(1),
  })
  .refine(
    (settings) =>
      new Set(settings.profiles.map((profile) => profile.id)).size === settings.profiles.length
  )
  .refine(
    (settings) =>
      settings.defaultProfileId === BROWSER_ISOLATED_PROFILE_ID ||
      settings.profiles.some((profile) => profile.id === settings.defaultProfileId)
  )
  // [XG-CUSTOM] 一个 bot 至多绑一个 profile（**不允许多 bot 共享 profile** —— 共享 = 串登录态）
  .refine((settings) => {
    const bound = settings.profiles
      .map((profile) => profile.botId)
      .filter((botId): botId is string => typeof botId === 'string' && botId !== '');
    return new Set(bound).size === bound.length;
  });

export const browserSettingsContribution = defineSettingsContribution<'browser', BrowserSettings>({
  key: 'browser',
  schema: browserSettingsSchema,
  defaults: {
    defaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
    relaxCorsForLocalhost: false,
    profiles: DEFAULT_BROWSER_PROFILES,
  },
});

export const browserPreviewSettingsContribution = defineSettingsContribution<
  'browserPreview',
  { enabled: boolean }
>({
  key: 'browserPreview',
  schema: z.object({ enabled: z.boolean() }),
  defaults: { enabled: true },
});
