// [XG-CUSTOM 2026-10-27] Dot 落卡详情 —— **改走 emdash 原生弹窗机制**。
//
// 为什么改（用户原话：「Dot 蓝字弹窗怎么没用上原生的…我是说用原生 emdash 的弹窗方式」）：
//   旧版 `xg-card-dialog.tsx` 是在面板里**裸挂一个 `Dialog.Root`** —— 它不进 emdash 的弹窗栈
//   （`modalStore` + `ModalRenderer`），所以：没有原生弹窗的尺寸档/遮罩/z 序、没有 Body/Footer 骨架
//   （正文和按钮塞在一个 div 里）、Esc 与焦点归还也不归原生管。看起来就是「自造弹窗」。
//
// 现在：与 `expertHandoffModal` **同一条路**（这是本仓既有的原生写法）
//   ① 组件里 `useModalController('xgCardModal')` 拿 dismiss
//   ② 文件底部 `defineModal<Props>()({ id, component, size })` 定义
//   ③ 注册进 `contributions/browser.ts` 的 `modalDefs` ⇒ `featureModalDefs` ⇒ `modalCatalog`
//   ④ 打开用 `openModal('xgCardModal', props)`（模块级函数，见 `@core/manifests/browser/modal-api`）
//   ⛔ **别再在面板里自造 Dialog**：要弹窗就往 `modalDefs` 里加一条。
import { Button, Dialog } from '@emdash/ui/react/primitives';
import { Bot } from 'lucide-react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';

export type XgCardModalProps = {
  /** 卡的文件路径（知识交换中心/📡 inbox/<bot>/dot-*.md） */
  path: string;
  /** 「看全文」：走 emdash **原生**打开文件（`openFileInTaskEditor`），由 `MarkdownEditorRenderer` 渲染正文 */
  onOpenFile: (path: string) => void;
  /** 「并入本轮」：交回面板发 `并入 <path>` */
  onMerge: (path: string) => void;
};

export function XgCardModal({ path, onOpenFile, onMerge }: XgCardModalProps) {
  const { dismiss } = useModalController('xgCardModal');
  const name = path.split('/').pop() ?? path;

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>
          <span className="flex items-center gap-2">
            {/* [XG-CUSTOM] 原生弹窗那一族的头部图标位（同 AgentDetailSheet 的写法：图标 + 标题） */}
            <Bot style={{ width: '1rem', height: '1rem' }} />
            {name || '卡片'}
          </span>
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <div className="flex flex-col gap-3 text-sm">
          <div className="break-all font-mono text-xs text-foreground-muted">{path}</div>
          <div className="text-foreground-muted">
            这是 Dot 跑完落的卡（来源 / 证据 / 结论都在卡里）。
            「看全文」用 emdash **原生**打开这个 .md（右侧编辑器，Markdown 渲染）；
            「并入本轮」把这张卡写进当前会话上下文 —— 同一会话里的专家也会在「近期主对话」里看到它。
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={() => dismiss()}>
          关闭
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            dismiss();
            onOpenFile(path);
          }}
        >
          看全文
        </Button>
        <Button
          onClick={() => {
            dismiss();
            onMerge(path);
          }}
        >
          并入本轮
        </Button>
      </Dialog.Footer>
    </>
  );
}

// ⚠️ `defineModal<**结果**类型>` 的泛型是**返回值**，不是 props（props 由 `component` 的签名推出来）：
//   本弹窗只「看/选」，没有返回值 ⇒ `void`。写成 `defineModal<XgCardModalProps>()` 会让
//   `openModal()` 的返回类型变成 `Result<XgCardModalProps, …>`，typecheck 立刻红（踩过一次）。
export const xgCardModal = defineModal<void>()({
  id: 'xgCardModal',
  component: XgCardModal,
  size: 'lg',
});
