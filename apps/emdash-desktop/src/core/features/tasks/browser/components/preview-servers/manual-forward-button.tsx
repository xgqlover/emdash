import { Dialog, Tooltip } from '@emdash/ui/react/primitives';
import { Globe, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { ManualForwardDialog } from './manual-forward-dialog';

export const ManualForwardButton = observer(function ManualForwardButton() {
  const [open, setOpen] = useState(false);
  const taskView = useTaskComposition();
  const disabledReason = projectAvailabilityUi.getLiveActionDisabledReason(taskView.projectId);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !disabledReason && setOpen(next)}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span
              className="inline-flex"
              tabIndex={disabledReason ? 0 : undefined}
              aria-label={disabledReason ?? undefined}
            />
          }
        >
          <button
            type="button"
            disabled={Boolean(disabledReason)}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Forward remote port"
            // [XG-CUSTOM] 2026-10-06 —— 用户真机把这个按钮当成「打开网址」点错过：
            //   它转发的是**远端端口**（把远端 dev server 隧道到本机预览），不是打开网址。
            //   语义（aria-label）保持不变，只把提示写清；功能一个字没改。
            //   「打开网址」请走命令面板 Ctrl+K → 「打开网址…」（browser.openUrl）。
            title="转发远端端口（预览 dev server），不是打开网址"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-3.5" />
            <Globe className="size-3.5" />
          </button>
        </Tooltip.Trigger>
        {/* [XG-CUSTOM] 2026-10-06 —— 提示文案写清「不是打开网址」（用户点错过） */}
        <Tooltip.Content>
          {disabledReason ?? '转发远端端口（预览 dev server），不是打开网址'}
        </Tooltip.Content>
      </Tooltip.Root>
      <ManualForwardDialog onClose={() => setOpen(false)} />
    </Dialog.Root>
  );
});
