// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { SettingsRow } from '@emdash/ui/react/patterns';
// [XG-CUSTOM 2026-10-16] 中文化取词入口（本文件含中文文案定制；同 scripts/xg-i18n/manifest.json）
import { t } from '@renderer/lib/i18n';
import { Field, Input, Select, Separator, Switch } from '@emdash/ui/react/primitives';
import { Github, Gitlab } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ProviderIdentityStrip } from '@core/features/integrations/contributions/browser/provider-identity-strip';
import { repositoryNameError } from '@core/features/repository/api/browser/repository-name';
import type { Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { type Strategy } from './add-project-modal';
import { DirectoryField } from './local-directory-selector';
import { type CloneModeState, type CreateRepositoryModeState, type PickModeState } from './modes';
import { OwnerSelector } from './owner-selector';
import { type ProjectDirectoryPickerClient } from './project-directory-picker';

export function PickExistingPanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  inspectionError,
  untrustedRepositoryNotice,
  showInitializeGitPrompt,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: PickModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  inspectionError?: string;
  /** Replaces the inspection error when Git refused the repository for its ownership. */
  untrustedRepositoryNotice?: ReactNode;
  showInitializeGitPrompt: boolean;
}) {
  return (
    <Field.Group>
      <Field.Root>
        <Field.Label>Directory</Field.Label>
        <DirectoryField
          strategy={strategy}
          connectionId={connectionId}
          path={state.path}
          onPathChange={state.handlePathChange}
          getProjectsClient={getProjectsClient}
          title={t('select_local_project')}
          message={t('select_project_directory')}
        />
      </Field.Root>
      {untrustedRepositoryNotice}
      {!untrustedRepositoryNotice && inspectionError && (
        <div className="border-destructive/40 overflow-hidden rounded-md border">
          <p className="border-destructive/30 bg-destructive/10 text-destructive border-b px-2 py-1 text-xs">
            Could not inspect this directory.
          </p>
          <p className="p-2 text-xs text-foreground-muted">{inspectionError}</p>
        </div>
      )}
      {showInitializeGitPrompt && (
        <div className="overflow-hidden rounded-md border border-border">
          <p className="border-b border-border bg-background-1 px-2 py-1 text-xs text-foreground-muted">
            This directory is not a git repository.
          </p>
          <div className="p-2">
            <Field.Root orientation="horizontal">
              <Switch
                checked={state.initGitRepository}
                onCheckedChange={state.setinitGitRepository}
              />
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
              <Field.Label>{t('initialize_git_repository')}</Field.Label>
            </Field.Root>
            <p className="mt-1.5 text-xs text-foreground-muted">
              You can also open this folder now and initialize Git later from the changes view.
            </p>
          </div>
        </div>
      )}
    </Field.Group>
  );
}

export function CreateRepositoryPanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  accounts,
  selectedAccount,
  defaultAccount,
  onAccountChange,
  onConnectProvider,
  provider,
  onProviderChange,
  ensureDefaultRoot,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: CreateRepositoryModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  accounts: ProviderAccountSummary[];
  selectedAccount: ProviderAccountSummary | null;
  defaultAccount: ProviderAccountSummary | null;
  onAccountChange: (accountId: string) => void;
  onConnectProvider: () => void;
  provider: 'github' | 'gitlab';
  onProviderChange: (provider: 'github' | 'gitlab') => void;
  ensureDefaultRoot: boolean;
}) {
  const repositoryNameId = useId();
  const nameError = repositoryNameError(provider, state.repositoryName);

  const resolvedAccount: Resolved<ProviderAccountSummary | null> = {
    value: defaultAccount,
    provenance: { kind: 'inferred', from: 'default account' },
  };
  const overrideAccount =
    selectedAccount && selectedAccount.accountId !== defaultAccount?.accountId
      ? selectedAccount
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Field.Root>
        <Field.Label>Provider</Field.Label>
        <Select.Root
          value={provider}
          onValueChange={(value) => onProviderChange(value as 'github' | 'gitlab')}
        >
          <Select.Trigger appearance="input" className="w-full" aria-label={t('repository_provider')}>
            {provider === 'github' ? 'GitHub' : 'GitLab'}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="github">GitHub</Select.Item>
            <Select.Item value="gitlab">GitLab</Select.Item>
          </Select.Content>
        </Select.Root>
      </Field.Root>
      <Field.Group>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,3fr)] items-end gap-2">
          <Field.Root className="min-w-0">
            <Field.Label>Owner</Field.Label>
            <OwnerSelector
              owners={state.owners}
              owner={state.repositoryOwner}
              accounts={accounts}
              selectedAccount={selectedAccount}
              onOwnerChange={state.handleOwnerChange}
              onAccountChange={onAccountChange}
              provider={provider}
            />
          </Field.Root>
          <span className="pb-2 text-sm text-foreground-muted">/</span>
          <Field.Root className="min-w-0">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
            <Field.Label htmlFor={repositoryNameId}>{t('repository_name')}</Field.Label>
            <Input
              id={repositoryNameId}
              autoFocus
              placeholder={t('enter_repository_name')}
              value={state.repositoryName}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? `${repositoryNameId}-error` : undefined}
              onChange={(e) => state.handleRepositoryNameChange(e.target.value)}
            />
          </Field.Root>
        </div>
        {nameError && (
          <p id={`${repositoryNameId}-error`} role="alert" className="text-destructive text-xs">
            {nameError}
          </p>
        )}
      </Field.Group>
      {state.repositoryOwnersErrorMessage && (
        <p role="alert" className="text-destructive text-xs">
          {state.repositoryOwnersErrorMessage}
        </p>
      )}
      <Separator className="w-full" />
      <SettingsRow
        label={t('choose_visibility')}
        description={t('choose_who_can_see_and_commit_to_this_re')}
        control={
          <Select.Root
            value={state.repositoryVisibility}
            onValueChange={(value) => state.setRepositoryVisibility(value as 'public' | 'private')}
          >
            <Select.Trigger appearance="input" className="max-w-28 min-w-28">
              {state.repositoryVisibility === 'private' ? 'Private' : 'Public'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="private">Private</Select.Item>
              <Select.Item value="public">Public</Select.Item>
            </Select.Content>
          </Select.Root>
        }
      />
      <Separator className="w-full" />
      <Field.Group>
        <Field.Root>
          <Field.Label>
            {strategy === 'local' ? 'Project Directory' : 'Remote Directory'}
          </Field.Label>
          <DirectoryField
            strategy={strategy}
            connectionId={connectionId}
            path={state.path}
            onPathChange={state.setPath}
            getProjectsClient={getProjectsClient}
            ensureDefaultRoot={ensureDefaultRoot}
            title={t('select_local_project')}
            message={t('select_project_directory')}
          />
        </Field.Root>
      </Field.Group>
      <ProviderIdentityStrip
        providerName={provider === 'github' ? 'GitHub' : 'GitLab'}
        providerIcon={
          provider === 'github' ? (
            <Github className="size-4 text-foreground-muted" />
          ) : (
            <Gitlab className="size-4 text-foreground-muted" />
          )
        }
        actionLabel={t('creating_as_2')}
        emptyState={{
          connect: `Connect a ${provider === 'github' ? 'GitHub' : 'GitLab'} account to continue.`,
          unavailable: `Choose a ${provider === 'github' ? 'GitHub' : 'GitLab'} account to continue.`,
          noMatch: 'No connected account matches this repository.',
        }}
        resolved={resolvedAccount}
        accounts={accounts}
        override={overrideAccount}
        persistence="action-only"
        accountRequired
        onSelect={(account) => onAccountChange(account.accountId)}
        onConnect={onConnectProvider}
      />
    </div>
  );
}

export function ClonePanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  ensureDefaultRoot,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: CloneModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  ensureDefaultRoot: boolean;
}) {
  const repositoryUrlId = useId();
  return (
    <div className="flex flex-col gap-6">
      <Field.Group>
        <Field.Root>
          <Field.Label htmlFor={repositoryUrlId}>{t('repository_url')}</Field.Label>
          <Input
            id={repositoryUrlId}
            autoFocus
            placeholder={t('enter_a_repository_url')}
            value={state.repositoryUrl}
            onChange={(e) => state.handleRepositoryUrlChange(e.target.value)}
          />
        </Field.Root>
      </Field.Group>
      <Separator className="w-full" />
      <Field.Group>
        <Field.Root>
          <Field.Label>
            {strategy === 'local' ? 'Project Directory' : 'Remote Directory'}
          </Field.Label>
          <DirectoryField
            strategy={strategy}
            connectionId={connectionId}
            path={state.path}
            onPathChange={state.setPath}
            getProjectsClient={getProjectsClient}
            ensureDefaultRoot={ensureDefaultRoot}
            title={t('select_local_project')}
            message={t('select_project_directory')}
          />
        </Field.Root>
      </Field.Group>
    </div>
  );
}
