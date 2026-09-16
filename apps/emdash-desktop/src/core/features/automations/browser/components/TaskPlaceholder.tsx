import { t } from '@renderer/lib/i18n';

export function TaskPlaceholder({ name }: { name: string | null }) {
  return (
    <div className="flex h-6 min-w-0 items-center">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground-passive">
        {name ?? t('creating_task')}
      </span>
    </div>
  );
}
