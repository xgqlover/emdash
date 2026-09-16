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
      <Field.Label>{t('task_name_label')}</Field.Label>
      <Input
        bare
        autoFocus
        value={taskName}
        placeholder={placeholder || t('task_name')}
        className="px-0 text-lg!"
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
          t('task_name_rules')
        </p>
      )}
    </Field.Root>
  );
}
