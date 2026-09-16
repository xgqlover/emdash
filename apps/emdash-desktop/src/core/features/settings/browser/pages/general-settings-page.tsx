import { t } from '@renderer/lib/i18n';
import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import { AccountTab } from '../components/AccountTab';
import NotificationSettingsCard from '../components/NotificationSettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CreateBranchAndWorktreeRow,
  DeleteBranchByDefaultRow,
  EnableTmuxRow,
  IncludeIssueContextByDefaultRow,
  PreserveTaskNameCapitalizationRow,
} from '../components/TaskSettingsRows';
import TelemetryCard from '../components/TelemetryCard';
import { UpdateCard } from '../components/UpdateCard';

export function GeneralSettingsPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageLayout.Header
        sticky
        draggable
        title={t('general')}
        description={t('general_desc')}
      />
      <SettingsSection>
        <AccountTab />
      </SettingsSection>
      <SettingsSection title={t('app')}>
        <UpdateCard />
        <TelemetryCard />
      </SettingsSection>
      <SettingsSection title={t('notifications')} bare>
        <NotificationSettingsCard />
      </SettingsSection>
      <SettingsSection title={t('preferences')}>
        <AutoGenerateTaskNamesRow />
        <AutoApproveByDefaultRow />
        <AutoTrustWorktreesRow />
        <CreateBranchAndWorktreeRow />
        <DeleteBranchByDefaultRow />
        <PreserveTaskNameCapitalizationRow />
        <IncludeIssueContextByDefaultRow />
        <EnableTmuxRow />
      </SettingsSection>
    </div>
  );
}
