// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { PromptLibraryView } from '../browser/prompts/prompt-library-view';

export const promptsSettingsPage = defineSettingsPageContribution({
  id: 'prompts',
// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
  label: t('prompts'),
  icon: 'message-square-text',
  component: PromptLibraryView,
} satisfies SettingsPageContribution<SettingsPageTab>);
