// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const SidebarMetadataSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const busy = isLoading || isSaving;
  const showLineChanges = interfaceSettings?.showLeftSidebarLineChanges ?? true;
  const showPrStatus = interfaceSettings?.showLeftSidebarPrStatus ?? true;
  const showTimestamps = interfaceSettings?.showLeftSidebarTimestamps ?? true;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <SettingRow
          title={t('left_sidebar_line_changes')}
          description={t('left_sidebar_line_changes_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarLineChanges')}
                defaultLabel={t('on')}
                onReset={() => resetField('showLeftSidebarLineChanges')}
                disabled={busy}
              />
              <Switch
                checked={showLineChanges}
                onCheckedChange={(checked) => update({ showLeftSidebarLineChanges: checked })}
                disabled={busy}
                aria-label={t('show_left_sidebar_line_changes')}
              />
            </>
          }
        />
        <SettingRow
          title={t('left_sidebar_pr_status')}
          description={t('left_sidebar_pr_status_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarPrStatus')}
                defaultLabel={t('on')}
                onReset={() => resetField('showLeftSidebarPrStatus')}
                disabled={busy}
              />
              <Switch
                checked={showPrStatus}
                onCheckedChange={(checked) => update({ showLeftSidebarPrStatus: checked })}
                disabled={busy}
                aria-label={t('show_left_sidebar_pr_status')}
              />
            </>
          }
        />
        <SettingRow
          title={t('left_sidebar_timestamps')}
          description={t('left_sidebar_timestamps_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarTimestamps')}
                defaultLabel={t('on')}
                onReset={() => resetField('showLeftSidebarTimestamps')}
                disabled={busy}
              />
              <Switch
                checked={showTimestamps}
                onCheckedChange={(checked) => update({ showLeftSidebarTimestamps: checked })}
                disabled={busy}
                aria-label={t('show_left_sidebar_timestamps')}
              />
            </>
          }
        />
      </SeparatedList>
    </SettingsCard>
  );
};

export default SidebarMetadataSettingsCard;
