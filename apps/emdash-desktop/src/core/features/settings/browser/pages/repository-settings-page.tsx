import { t } from '@renderer/lib/i18n';
import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import RepositorySettingsCard from '../components/RepositorySettingsCard';

export function RepositorySettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title={t('repository')}
        description={t('repository_desc')}
      />
      <SettingsSection title={t('branches')} bare>
        <RepositorySettingsCard />
      </SettingsSection>
    </div>
  );
}
