import { t } from '@renderer/lib/i18n';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { Input, SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { normalizeBranchPrefix } from '@core/primitives/tasks/api';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const RepositorySettingsCard: React.FC = () => {
  const {
    value: project,
    update: updateProject,
    isLoading: projectLoading,
    isSaving: projectSaving,
    isFieldOverridden: isProjectFieldOverridden,
    resetField: resetProjectField,
  } = useAppSettingsKey('project');
  const branchPrefix = project?.branchPrefix ?? '';
  const appendRandomBranchSuffix = project?.appendRandomBranchSuffix ?? true;
  const pushOnCreate = project?.pushOnCreate ?? true;
  const projectBusy = projectLoading || projectSaving;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Input
              key={branchPrefix}
              defaultValue={branchPrefix}
              onBlur={(e) => {
                const next = normalizeBranchPrefix(e.currentTarget.value);
                e.currentTarget.value = next;
                if (next !== branchPrefix) {
                  updateProject({ branchPrefix: next });
                }
              }}
              placeholder={t('branch_prefix')}
              aria-label={t('branch_prefix')}
              disabled={projectBusy}
              className="flex-1"
            />
            <ResetToDefaultButton
              visible={isProjectFieldOverridden('branchPrefix')}
              defaultLabel="emdash"
              onReset={() => resetProjectField('branchPrefix')}
              disabled={projectBusy}
            />
          </div>
          <div className="text-xs text-foreground-passive">
            {t('branch_prefix_empty')}
          </div>
        </div>
        <SettingRow
          title={t('random_branch_suffix')}
          description={t('random_branch_suffix_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isProjectFieldOverridden('appendRandomBranchSuffix')}
                defaultLabel={t('on')}
                onReset={() => resetProjectField('appendRandomBranchSuffix')}
                disabled={projectBusy}
              />
              <Switch
                checked={appendRandomBranchSuffix}
                onCheckedChange={(checked) => updateProject({ appendRandomBranchSuffix: checked })}
                disabled={projectBusy}
                aria-label="Append random branch suffix"
              />
            </>
          }
        />
        <SettingRow
          title={t('auto_push_on_create')}
          description={t('auto_push_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isProjectFieldOverridden('pushOnCreate')}
                defaultLabel={t('on')}
                onReset={() => resetProjectField('pushOnCreate')}
                disabled={projectBusy}
              />
              <Switch
                checked={pushOnCreate}
                onCheckedChange={(checked) => updateProject({ pushOnCreate: checked })}
                disabled={projectBusy}
                aria-label="Enable automatic push on create"
              />
            </>
          }
        />
      </SeparatedList>
    </SettingsCard>
  );
};

export default RepositorySettingsCard;
