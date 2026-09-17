import { Label } from '@emdash/ui/react/primitives';
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
        <Label>{t('start_with_template')}</Label>
        <p className="max-w-xl text-sm text-foreground-muted">
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
