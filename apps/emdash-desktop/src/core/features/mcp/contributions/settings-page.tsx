// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { McpIcon } from '@emdash/ui/react/components';
import { McpView } from '@core/features/mcp/browser/components/McpView';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';

export const mcpSettingsPage = defineSettingsPageContribution({
  id: 'mcp',
// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
  label: t('mcp'),
  icon: <McpIcon size={14} />,
  component: McpView,
} satisfies SettingsPageContribution<SettingsPageTab>);
