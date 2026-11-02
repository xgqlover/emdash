import { toast } from '@emdash/ui/react/primitives';
import React from 'react';

type ModalErrorBoundaryProps = {
  /** Modal id, used only in the toast description. */
  modalId: string;
  /** Closes just this modal (the host's own dismiss callback). */
  onDismiss: () => void;
  children?: React.ReactNode;
};

type ModalErrorBoundaryState = { failed: boolean };

/**
 * [XG-CUSTOM 2026-11-02] 弹窗的**局部**错误边界。
 *
 * 背景（真机 2026-11-02）：`create-task-modal` 的 props 少声明 `initialWorkspaceId`
 * ⇒ 点「+」直接抛 `ReferenceError` ⇒ 被包着整个 app 的 `renderer/error-boundary.tsx`
 * 接住 ⇒ 整页变成 "Emdash couldn't display that view"，用户只能 Reload。
 *
 * 现在：弹窗内部渲染抛错时，只**关掉这个弹窗** + 一条 Toast（带原始 message），
 * 其余界面照常可用。app 级 ErrorBoundary 只兜「弹窗系统之外」的崩溃。
 */
export class ModalErrorBoundary extends React.Component<
  ModalErrorBoundaryProps,
  ModalErrorBoundaryState
> {
  constructor(props: ModalErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): Partial<ModalErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    // Close first so the broken dialog never stays on screen as an empty shell.
    this.props.onDismiss();
    toast.error('This dialog could not be displayed', {
      description: error?.message ?? String(error),
    });
  }

  render(): React.ReactNode {
    if (this.state.failed) return null;
    return this.props.children ?? null;
  }
}
