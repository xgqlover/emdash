// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const InterfaceSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const hideContextBar = interfaceSettings?.hideContextBar ?? false;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <SettingRow
          title={t('context_bar')}
          description={t('context_bar_desc')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('hideContextBar')}
                defaultLabel={t('shown')}
                onReset={() => resetField('hideContextBar')}
                disabled={loading || saving}
              />
              <Switch
                checked={hideContextBar}
                disabled={loading || saving}
                onCheckedChange={(checked) => update({ hideContextBar: checked })}
              />
            </>
          }
        />
      </SeparatedList>
    </SettingsCard>
  );
};

export default InterfaceSettingsCard;
