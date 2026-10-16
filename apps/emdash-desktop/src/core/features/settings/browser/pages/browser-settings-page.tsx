// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { PageLayout } from '@emdash/ui/react/patterns';
import { BrowserSettingsCard } from '../components/BrowserSettingsCard';

export function BrowserSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title={t('browser')}
        description={t('browser_desc')}
      />
      <BrowserSettingsCard />
    </div>
  );
}
