// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { SkillsView } from '@core/features/skills/browser/components/SkillsView';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';

export const skillsSettingsPage = defineSettingsPageContribution({
  id: 'skills',
// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
  label: t('skills'),
  icon: 'brain',
  component: SkillsView,
} satisfies SettingsPageContribution<SettingsPageTab>);
