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
