import { redactAll } from '@emdash/shared/logger';
import { Button, Popover } from '@emdash/ui/react/primitives';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export function ProjectErrorDetails({ message }: { message?: string }) {
  const detail = message?.trim();
  if (!detail) return null;
  const redacted = redactAll(detail);

  return (
    <Popover.Root key={redacted}>
      <Popover.Trigger render={<Button type="button" size="sm" variant="ghost" />}>
        Error details
      </Popover.Trigger>
      <Popover.Content className="w-96 max-w-[calc(100vw-2rem)]">
        <Popover.Header>
          <Popover.Title>{t('error_details')}</Popover.Title>
        </Popover.Header>
        <pre className="max-h-64 overflow-auto text-xs break-words whitespace-pre-wrap select-text">
          {redacted}
        </pre>
      </Popover.Content>
    </Popover.Root>
  );
}
