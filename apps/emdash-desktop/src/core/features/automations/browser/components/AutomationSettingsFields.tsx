import { Field, Input, Label } from '@emdash/ui/react/primitives';
import { CronPicker } from '@core/features/automations/browser/CronPicker';
import { ProjectSelector } from '@core/features/tasks/contributions/browser/project-selector';
import { ConversationField } from '@core/features/tasks/contributions/browser/task-config/conversation-field';
import { TaskConfigProvider } from '@core/features/tasks/contributions/browser/task-config/task-config-context';
import { TaskConfigPanel } from '@core/features/tasks/contributions/browser/task-config/task-config-panel';
import { TaskStateProvider } from '@core/features/tasks/contributions/browser/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@core/features/tasks/contributions/browser/task-config/workspace-settings-section';
import { t } from '@renderer/lib/i18n';
import type { AutomationFormState } from '../useAutomationFormState';

// [XG-CUSTOM 2026-10-05] 本文件加的东西：触发源切换（On schedule / On event）+ 事件触发的
// token / filter / 回调地址三块（协议与安全约定见 primitives/automations/api/config.ts）

interface AutomationSettingsFieldsProps {
  state: AutomationFormState;
  cronError: string | null;
  onCronExprChange: (expr: string) => void;
  onCronErrorClear: () => void;
  onPromptBlur?: () => void;
  error?: string | null;
  disabled?: boolean;
}

export function AutomationSettingsFields({
  state,
  cronError,
  onCronExprChange,
  onCronErrorClear,
  onPromptBlur,
  error,
  disabled = false,
}: AutomationSettingsFieldsProps) {
  const {
    initialConversation,
    cronExpr,
    workspaceConfig,
    effectiveProjectId,
    isUnborn,
    hasRepository,
    setProjectId,
  } = state;

  return (
    <fieldset disabled={disabled} className="contents">
      <Field.Group>
        <Field.Root>
          <Label>Project</Label>
          <ProjectSelector
            value={effectiveProjectId}
            onChange={(nextProjectId) => setProjectId(nextProjectId)}
          />
        </Field.Root>
        <Field.Root>
          <Label>Trigger</Label>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={state.triggerKind === 'cron'}
              className={state.triggerKind === 'cron' ? 'font-medium underline' : 'opacity-70'}
              onClick={() => state.setTriggerKind('cron')}
            >
              On schedule
            </button>
            <button
              type="button"
              aria-pressed={state.triggerKind === 'webhook'}
              className={state.triggerKind === 'webhook' ? 'font-medium underline' : 'opacity-70'}
              onClick={() => state.setTriggerKind('webhook')}
            >
              On event
            </button>
          </div>
        </Field.Root>
        {state.triggerKind === 'cron' ? (
          <Field.Root>
            <Label>Schedule</Label>
            <CronPicker
              value={cronExpr}
              onChange={(nextCronExpr) => {
                onCronExprChange(nextCronExpr);
                onCronErrorClear();
              }}
            />
            {cronError && <Field.Error match>{cronError}</Field.Error>}
          </Field.Root>
        ) : (
          <>
            <Field.Root>
              <Label>Callback token</Label>
              <div className="flex gap-2">
                <Input
                  value={state.webhookToken}
                  onChange={(event) => state.setWebhookToken(event.target.value)}
                  placeholder="至少 8 位"
                />
                <button type="button" onClick={() => state.setWebhookToken(crypto.randomUUID())}>
                  Generate
                </button>
              </div>
            </Field.Root>
            <Field.Root>
              <Label>Event filter (optional)</Label>
              <Input
                value={state.webhookFilter}
                onChange={(event) => state.setWebhookFilter(event.target.value)}
                placeholder={'action == "opened"'}
              />
            </Field.Root>
            <Field.Root>
              <Label>Callback URL</Label>
              <code className="text-xs">{'http://127.0.0.1:7823/automation/<automationId>'}</code>
              <p className="text-xs opacity-70">
                POST 该地址，请求头 x-emdash-automation-token: &lt;token&gt;；保存后才会有
                automation id。
              </p>
            </Field.Root>
          </>
        )}
        <TaskStateProvider
          workspaceConfig={workspaceConfig}
          initialConversation={initialConversation}
          projectId={effectiveProjectId}
          isUnborn={isUnborn}
          hasRepository={hasRepository}
          hasPR={false}
          includeIssueContextByDefault={false}
        >
          <TaskConfigProvider showPrPresets={false} autoBranchName={true}>
            <TaskConfigPanel
              tabs={[
                {
                  value: 'prompt',
                  label: 'Prompt',
                  content: (
                    <ConversationField
                      onPromptBlur={onPromptBlur}
                      textareaClassName="min-h-40"
                      placeholder={t('add_prompt')}
                      showAutoApproveToggle={false}
                      requirePromptDelivery={true}
                    />
                  ),
                },
                {
                  value: 'workspace',
                  label: 'Workspace Settings',
                  content: <WorkspaceSettingsSection defaultOpen={true} />,
                },
              ]}
            />
          </TaskConfigProvider>
        </TaskStateProvider>
      </Field.Group>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </fieldset>
  );
}
