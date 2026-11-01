import { Button, Dialog } from '@emdash/ui/react/primitives';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export type UnsavedChangesDialogResult = 'save' | 'discard';

export type UnsavedChangesDialogArgs = {
  fileName: string;
};

export function UnsavedChangesDialog({ fileName }: UnsavedChangesDialogArgs) {
  const controller = useModalController('unsavedChangesModal');

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>{t('unsaved_changes')}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <p>
          Do you want to save the changes to <strong>{fileName}</strong>?
        </p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={() => controller.complete('discard')}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => controller.complete('save')}>
          Save
        </Button>
      </Dialog.Footer>
    </>
  );
}

export const unsavedChangesModal = defineModal<UnsavedChangesDialogResult>()({
  id: 'unsavedChangesModal',
  component: UnsavedChangesDialog,
  size: 'xs',
});
