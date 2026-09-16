import { t } from '@renderer/lib/i18n';

export function AutomationsBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center px-2">
      <span className="max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm text-foreground">
        {t('automations')}
      </span>
    </nav>
  );
}
