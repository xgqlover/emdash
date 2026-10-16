// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';

export function AutomationsBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center px-2">
      <span className="max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm text-foreground">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
        {t('automations')}
      </span>
    </nav>
  );
}
