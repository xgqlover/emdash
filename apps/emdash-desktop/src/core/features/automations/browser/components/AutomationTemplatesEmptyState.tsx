// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { Label } from '@emdash/ui/react/primitives';
// [XG-CUSTOM 2026-10-16] 中文化取词入口（本文件含中文文案定制；同 scripts/xg-i18n/manifest.json）
import { t } from '@renderer/lib/i18n';
import type { BuiltinAutomationTemplate } from '../automation-template';
import { AutomationTemplateCard } from './AutomationTemplateCard';

interface AutomationTemplatesEmptyStateProps {
  templates: BuiltinAutomationTemplate[];
  onSelectTemplate: (template: BuiltinAutomationTemplate) => void;
}

export function AutomationTemplatesEmptyState({
  templates,
  onSelectTemplate,
}: AutomationTemplatesEmptyStateProps) {
  return (
    <section className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
        <Label>{t('start_with_template')}</Label>
        <p className="max-w-xl text-sm text-foreground-muted">
{/* [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json */}
          {t('choose_template_desc')}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {templates.map((template) => (
          <div key={template.id} className="h-full min-w-0">
            <AutomationTemplateCard
              template={template}
              onSelect={onSelectTemplate}
              className="h-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
