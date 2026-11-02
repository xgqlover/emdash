import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ModalErrorBoundary } from './modal-error-boundary';

// [XG-CUSTOM 2026-11-02] 弹窗局部错误边界：抛错只关弹窗 + Toast，不许把整页接管。
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@emdash/ui/react/primitives', () => ({
  toast: { error: toastError },
}));

describe('ModalErrorBoundary', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let onDismiss: Mock<() => void>;

  function CrashingDialog(): never {
    throw new Error('initialWorkspaceId is not defined');
  }

  beforeEach(() => {
    vi.resetAllMocks();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container, { onCaughtError: () => {} });
    onDismiss = vi.fn<() => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('renders its children untouched when the dialog does not throw', () => {
    act(() => {
      root.render(
        React.createElement(
          ModalErrorBoundary,
          { modalId: 'taskModal', onDismiss },
          React.createElement('p', null, 'dialog body')
        )
      );
    });

    expect(container.textContent).toContain('dialog body');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('closes only the dialog and toasts instead of taking over the whole view', () => {
    act(() => {
      root.render(
        React.createElement(
          ModalErrorBoundary,
          { modalId: 'taskModal', onDismiss },
          React.createElement(CrashingDialog)
        )
      );
    });

    // The modal is dismissed exactly once…
    expect(onDismiss).toHaveBeenCalledOnce();
    // …the operator sees the reason…
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError.mock.calls[0]?.[1]).toMatchObject({
      description: 'initialWorkspaceId is not defined',
    });
    // …and nothing of the app-level fallback is rendered in this subtree.
    expect(container.textContent).toBe('');
    expect(container.textContent).not.toContain('display that view');
  });
});
