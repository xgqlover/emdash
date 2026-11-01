import { PageLayout } from '@emdash/ui/react/patterns';
import type { SettingsPageProps } from '@core/primitives/settings/api/page-contribution';
import { WorkspacesListView } from '../components/workspaces-list-view';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export function LocalWorkspacesSettingsPage({ openDetail }: SettingsPageProps) {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces"
        description={t('review_local_project_workspaces_and_remo')}
      />
      <WorkspacesListView scope={{ kind: 'local' }} openDetail={openDetail} />
    </div>
  );
}
