import { useEffect, useRef, useState } from 'react';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]
import { Field, Input } from '@emdash/ui/react/primitives';
import { type TaskNameState } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  // [XG-CUSTOM 2026-11-03] **中文输入法（IME）修复**：原来每个键都走
  //   `liveTransformTaskName`（空格→`-`、非字母数字\p{L} 全删）并 setState ⇒
  //   受控 value 在**组合过程中**被改写 ⇒ 输入法被打断：候选词被提前提交、拼音片段被拼成
  //   `-` 连成一串（用户实测「中文字输入有点难，总出短杆」）。
  //   修法：**组合期间只用本地值、不回写受控值**；`compositionend` 才把最终串交给上层转换。
  const [draft, setDraft] = useState(taskName);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setDraft(taskName);
  }, [taskName]);

  return (
    <Field.Root className="flex flex-col gap-1">
      <Input
        aria-label={t('task_name_label')}
        bare
        autoFocus
        value={draft}
        placeholder={placeholder || t('task_name')}
        className="px-0 text-lg!"
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          const v = (e.target as HTMLInputElement).value;
          setDraft(v);
          handleTaskNameChange(v);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          // 组合中不触发上层转换（否则受控值回写会打断 IME）
          if (!composingRef.current) handleTaskNameChange(v);
        }}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
          {t('task_name_rules')}
        </p>
      )}
    </Field.Root>
  );
}
