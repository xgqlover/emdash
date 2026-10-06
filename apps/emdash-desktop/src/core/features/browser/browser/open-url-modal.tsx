// [XG-CUSTOM] 2026-10-06 —— 「打开网址」输入框：`browser.openUrl` 命令在命令面板里被选中后弹的那个框。
//
// 为什么是 modal 而不是「命令面板里直接输入」：本仓的 palette 项只能以 `undefined` 调用
// （`defineCommandPaletteCatalog` 硬校验 `input.safeParse(undefined).success`），**不支持带输入的项**，
// 所以「输入网址」这一步只能用仓库既有的 modal 基础设施兜底 —— 这里用的就是既有的
// `Dialog` / `Field` / `Input` / `Button`（`@emdash/ui/react/primitives`）+ `defineModal`，
// 没有自造 UI 基础设施，也没有引入新依赖。
import { Button, Dialog, Field, Input } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { resolveOpenUrlInput } from '@core/features/browser/browser/open-url-command';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';

export type OpenUrlModalArgs = {
  /** 预填（目前命令面板路径不预填，留个口子给以后的入口） */
  readonly initialUrl?: string;
};

export function OpenUrlModal({ initialUrl }: OpenUrlModalArgs) {
  const { complete, dismiss } = useModalController('openUrlModal');
  const [value, setValue] = useState(initialUrl ?? '');
  const resolved = resolveOpenUrlInput(value);
  const showError = value.trim() !== '' && !resolved.ok;

  const submit = () => {
    if (!resolved.ok) return;
    complete(resolved.url);
  };

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>打开网址</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <Field.Group>
          <Field.Root>
            <Field.Label>网址</Field.Label>
            <Input
              autoFocus
              value={value}
              placeholder="https://example.com"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            {showError && <p className="text-destructive mt-1 text-xs">{resolved.message}</p>}
          </Field.Root>
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={dismiss}>
          取消
        </Button>
        <ConfirmButton variant="primary" onClick={submit} disabled={!resolved.ok}>
          打开
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
}

export const openUrlModal = defineModal<string>()({
  id: 'openUrlModal',
  component: OpenUrlModal,
  size: 'sm',
});
