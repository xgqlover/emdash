import { Button, Dialog } from '@emdash/ui/react/primitives';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export type QuitUnsavedChangesResult = 'save-all' | 'discard';

export interface QuitUnsavedChangesDialogArgs {
  count: number;
}

export function QuitUnsavedChangesDialog({ count }: QuitUnsavedChangesDialogArgs) {
  const controller = useModalController('quitUnsavedChangesModal');
  const label = count === 1 ? 'file has' : 'files have';

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>{t('save_changes_before_quitting')}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <p>
          {count} {label} unsaved changes. Save them before quitting Emdash?
        </p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={controller.dismiss}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => controller.complete('discard')}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => controller.complete('save-all')}>
          Save All
        </Button>
      </Dialog.Footer>
    </>
  );
}

export const quitUnsavedChangesModal = defineModal<QuitUnsavedChangesResult>()({
  id: 'quitUnsavedChangesModal',
  component: QuitUnsavedChangesDialog,
  size: 'sm',
});
