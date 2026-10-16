// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { PageLayout } from '@emdash/ui/react/patterns';
import IntegrationsCard from '../components/IntegrationsCard';

export function IntegrationsSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title={t('integrations')}
        description={t('integrations_desc')}
      />
      <IntegrationsCard />
    </div>
  );
}
