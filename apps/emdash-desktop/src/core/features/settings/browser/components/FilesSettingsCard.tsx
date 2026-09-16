import { t } from '@renderer/lib/i18n';
import { normalizeExclusionPatterns } from '@emdash/core/primitives/exclusion-policy/api';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Textarea } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { FilesSettings } from '@core/primitives/app-settings/api';
import { ResetToDefaultButton } from './ResetToDefaultButton';

type ExclusionField = keyof FilesSettings;

type ExclusionListEditorProps = {
  title: string;
  description: string;
  field: ExclusionField;
  value: readonly string[];
  loading: boolean;
  saving: boolean;
  overridden: boolean;
  onCommit(field: ExclusionField, value: string[]): void;
  onReset(field: ExclusionField): void;
};

const FilesSettingsCard: React.FC = () => {
  const {
    value: files,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('files');

  const current: FilesSettings = files ?? {
    treeExclude: [],
    searchExclude: [],
    watcherExclude: [],
  };

  const commitField = (field: ExclusionField, value: string[]) => {
    update({ [field]: normalizeExclusionPatterns(value) });
  };

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <ExclusionListEditor
          title={t('file_tree_exclusions')}
          description={t('file_tree_exclusions_desc')}
          field="treeExclude"
          value={current.treeExclude}
          loading={loading}
          saving={saving}
          overridden={isFieldOverridden('treeExclude')}
          onCommit={commitField}
          onReset={resetField}
        />
        <ExclusionListEditor
          title={t('search_exclusions')}
          description={t('search_exclusions_desc')}
          field="searchExclude"
          value={current.searchExclude}
          loading={loading}
          saving={saving}
          overridden={isFieldOverridden('searchExclude')}
          onCommit={commitField}
          onReset={resetField}
        />
        <ExclusionListEditor
          title={t('watcher_exclusions')}
          description={t('watcher_exclusions_desc')}
          field="watcherExclude"
          value={current.watcherExclude}
          loading={loading}
          saving={saving}
          overridden={isFieldOverridden('watcherExclude')}
          onCommit={commitField}
          onReset={resetField}
        />
      </SeparatedList>
    </SettingsCard>
  );
};

function ExclusionListEditor({
  title,
  description,
  field,
  value,
  loading,
  saving,
  overridden,
  onCommit,
  onReset,
}: ExclusionListEditorProps): React.JSX.Element {
  const serialized = value.join('\n');
  const [draft, setDraft] = React.useState(serialized);

  React.useEffect(() => {
    setDraft(serialized);
  }, [serialized]);

  const commit = () => {
    const patterns = draft.split(/\r?\n/u);
    const normalized = normalizeExclusionPatterns(patterns);
    if (normalized.join('\n') !== serialized) onCommit(field, normalized);
    else setDraft(serialized);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-foreground">{title}</div>
          <div className="text-muted-foreground text-xs">{description}</div>
        </div>
        <ResetToDefaultButton
          visible={overridden}
          defaultLabel={t('defaults')}
          onReset={() => onReset(field)}
          disabled={loading || saving}
        />
      </div>
      <Textarea
        value={draft}
        placeholder={t('one_pattern_per_line')}
        rows={4}
        disabled={loading || saving}
        spellCheck={false}
        className="font-mono text-xs"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
      />
    </div>
  );
}

export default FilesSettingsCard;
