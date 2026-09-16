import { t } from '@renderer/lib/i18n';
import { Switch, Tooltip } from '@emdash/ui/react/primitives';
import { Info } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            type="button"
            className="text-muted-foreground inline-flex h-4 w-4 items-center justify-center hover:text-foreground"
            aria-label={label}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" className="max-w-xs text-xs">
          {content}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export const AutoGenerateTaskNamesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('auto_generate_task_names')}
      description={t('auto_generate_task_names_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoGenerateName')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoGenerateName}
          />
        </>
      }
    />
  );
};

export const AutoApproveByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('auto_approve_by_default')}
      description={t('auto_approve_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoApproveByDefault')}
            defaultLabel="off"
            onReset={taskSettings.resetAutoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoApproveByDefault}
          />
        </>
      }
    />
  );
};

export const AutoTrustWorktreesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={
        <div className="flex items-center gap-1.5">
          {t('auto_trust_worktrees')}
          <InfoTooltip
            label={t('auto_trust_tooltip')}
            content={t('auto_trust_tooltip_desc')}
          />
        </div>
      }
      description={t('auto_trust_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoTrustWorktrees')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoTrustWorktrees}
          />
        </>
      }
    />
  );
};

export const CreateBranchAndWorktreeRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('create_branch_worktree')}
      description={t('create_branch_worktree_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('createBranchAndWorktree')}
            defaultLabel="on"
            onReset={taskSettings.resetCreateBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.createBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateCreateBranchAndWorktree}
          />
        </>
      }
    />
  );
};

export const DeleteBranchByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('delete_branch_by_default')}
      description={t('delete_branch_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('deleteBranchByDefault')}
            defaultLabel="off"
            onReset={taskSettings.resetDeleteBranchByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.deleteBranchByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateDeleteBranchByDefault}
          />
        </>
      }
    />
  );
};

export const PreserveTaskNameCapitalizationRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('preserve_capitalization')}
      description={t('preserve_capitalization_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('preserveNameCapitalization')}
            defaultLabel="off"
            onReset={taskSettings.resetPreserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.preserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updatePreserveNameCapitalization}
          />
        </>
      }
    />
  );
};

export const IncludeIssueContextByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('include_issue_context')}
      description={t('include_issue_context_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('includeIssueContextByDefault')}
            defaultLabel="on"
            onReset={taskSettings.resetIncludeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.includeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateIncludeIssueContextByDefault}
          />
        </>
      }
    />
  );
};

export const EnableTmuxRow: React.FC = () => {
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxByDefault = projects?.tmuxByDefault ?? false;

  return (
    <SettingRow
      title={t('enable_tmux')}
      description={t('enable_tmux_desc')}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('tmuxByDefault')}
            defaultLabel="off"
            onReset={() => resetField('tmuxByDefault')}
            disabled={loading || saving}
          />
          <Switch
            checked={tmuxByDefault}
            disabled={loading || saving}
            onCheckedChange={(checked) => update({ tmuxByDefault: checked })}
          />
        </>
      }
    />
  );
};
