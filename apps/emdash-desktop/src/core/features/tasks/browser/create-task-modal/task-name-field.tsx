import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]
import { Field, Input } from '@emdash/ui/react/primitives';
import { type TaskNameState } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field.Root className="flex flex-col gap-1">
      <Input
        aria-label={t('task_name_label')}
        bare
        autoFocus
        value={taskName}
        placeholder={placeholder || t('task_name')}
        className="px-0 text-lg!"
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
          t('task_name_rules')
        </p>
      )}
    </Field.Root>
  );
}
