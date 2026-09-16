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
