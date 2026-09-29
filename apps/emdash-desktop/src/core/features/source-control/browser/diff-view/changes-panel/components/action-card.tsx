import { card } from '@emdash/ui/styles/recipes/card';
import { type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

interface ActionCardProps {
  selectedCount: number;
  selectionActions: ReactNode;
  generalActions: ReactNode;
}

export function ActionCard({ selectedCount, selectionActions, generalActions }: ActionCardProps) {
  const hasSelection = selectedCount > 0;
  return (
    <div
      className={cn(
        card({ level: 'elevated-emphasis', radius: 'md', padding: 'sm' }),
        'mx-2 flex shrink-0 items-center justify-between'
      )}
    >
      <span className="min-w-0 truncate text-xs text-foreground-muted">
        {hasSelection
          ? t('files_selected', { count: selectedCount })
          : t('all_files')}
      </span>
      <div className="flex items-center gap-1.5">
        {hasSelection ? selectionActions : generalActions}
      </div>
    </div>
  );
}
