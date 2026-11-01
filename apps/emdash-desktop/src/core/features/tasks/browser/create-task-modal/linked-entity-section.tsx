// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { Button, ToggleGroup } from '@emdash/ui/react/primitives';
import { IssueComboboxField } from './issue-combobox-field';
import { PrComboboxField } from './pr-combobox-field';
import type { LinkedType, CreateTaskState } from './use-create-task-state';

interface LinkedEntitySectionProps {
  state: CreateTaskState;
  hasAnyIssueIntegration: boolean;
  hasPrSupport: boolean;
  requestProvider?: string;
  issueLabel: string;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
}

export function LinkedEntitySection({
  state,
  hasAnyIssueIntegration,
  hasPrSupport,
  requestProvider,
  issueLabel,
  projectId,
  repositoryUrl,
  projectPath,
}: LinkedEntitySectionProps) {
  return (
    <div className="flex w-full flex-col justify-between overflow-hidden rounded-lg border">
      <div
        className={`flex w-full items-center justify-between gap-2 px-2 py-1 ${state.linkedType ? 'border-b' : ''}`}
      >
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
        <span className="shrink-0 text-sm text-foreground-muted">{t('based_on')}</span>
        <ToggleGroup.Root
          className="bg-transparent"
          value={state.linkedType ? [state.linkedType] : []}
          onValueChange={([v]) => {
            state.setLinkedType((v as LinkedType) ?? null);
          }}
        >
          <ToggleGroup.Item className="text-xs" value="issue" disabled={!hasAnyIssueIntegration}>
    {/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
                {t('issue')}
              </ToggleGroup.Item>
              <ToggleGroup.Item className="text-xs" value="pr" disabled={!hasPrSupport}>
    {/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
                {t(requestProvider === 'gitlab' ? 'merge_request' : 'pull_request')}
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      {state.linkedType === 'issue' && (
        <>
          <IssueComboboxField
            value={state.linkedIssue}
            onValueChange={state.setLinkedIssue}
            projectId={projectId}
            repositoryUrl={repositoryUrl}
            projectPath={projectPath}
          />
          {state.issueContextPending && (
            <p role="status" className="px-3 pb-2 text-xs text-foreground-muted">
              Loading ticket context…
            </p>
          )}
          {state.issueContextError && (
            <div role="alert" className="flex items-center gap-2 px-3 pb-2 text-xs">
              <span>{state.issueContextError}</span>
              <Button type="button" variant="link" size="sm" onClick={state.retryIssueContext}>
                Retry
              </Button>
            </div>
          )}
        </>
      )}
      {state.linkedType === 'pr' && (
        <PrComboboxField
          provider={requestProvider}
          value={state.linkedPR}
          onValueChange={state.setLinkedPR}
          projectId={projectId}
          repositoryUrl={repositoryUrl}
        />
      )}
    </div>
  );
}
