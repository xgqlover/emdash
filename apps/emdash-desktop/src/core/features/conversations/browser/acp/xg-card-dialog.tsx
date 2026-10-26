// [XG-CUSTOM 2026-10-26] Dot 落卡的详情弹窗（蓝字入口 → 这里 → 并入本轮）。
// 复用 emdash 原生 Dialog/Button（与 expert-handoff-modal 同风格），不自造弹窗框架。
import { Button, Dialog } from '@emdash/ui/react/primitives';

export type XgCardTarget = { path: string; title?: string };

export function XgCardDialog({
  card,
  onClose,
  onOpenFull,
  onMerge,
}: {
  card: XgCardTarget | null;
  onClose: () => void;
  onOpenFull: (path: string) => void;
  onMerge: (path: string) => void;
}) {
  const p = card?.path ?? '';
  const name = p.split('/').pop() ?? p;
  return (
    <Dialog.Root
      open={!!card}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>{name || '卡片'}</Dialog.Title>
        </Dialog.Header>
        <div className="flex flex-col gap-3 text-sm">
          <div className="text-foreground-muted break-all font-mono text-xs">{p}</div>
          <div className="text-foreground-muted">
            这是 Dot 跑完落的卡（来源 / 证据 / 结论都在卡里）。
            「看全文」让项我把卡读出来；「并入本轮」把这张卡写进当前会话上下文 —
            同一会话里的专家也会在「近期主对话」里看到它。
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button variant="secondary" onClick={() => p && onOpenFull(p)}>
              看全文
            </Button>
            <Button onClick={() => p && onMerge(p)}>并入本轮</Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
