import { toast } from '@emdash/ui/react/primitives';
// [XG-CUSTOM] 2026-10-06 —— 复用开页（同 profile 的已有 browser 标签 → 导航它，不叠新标签）
import { openBrowserTabOrReuse } from '@core/features/browser/api/browser/open-browser-tab';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { openModal } from '@core/manifests/browser/modal-api';
import {
  copyTextToClipboard,
  openExternal,
} from '@core/primitives/desktop-host/browser/host-client';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  const taskView = getActiveTaskView();

  void openModal('confirmExternalLinkModal', {
    url: normalizedUrl,
    canOpenInEmdashBrowser: taskView !== undefined,
    onCopy: () => copyExternalLink(normalizedUrl),
  }).then((outcome) => {
    if (!outcome.success) return;
    if (outcome.data === 'emdash-browser') {
      // [XG-CUSTOM] 2026-10-06 —— 复用开页：同一个 task 里已有同 profile 的 browser 标签 → 导航它，
      // 不再叠新标签（用户"重复打开"的真机病根）。找不到 / profile 不同 → 与改动前逐字节一致：新开。
      if (taskView !== undefined) openBrowserTabOrReuse(taskView, { initialUrl: normalizedUrl });
      taskView?.setFocusedRegion('main');
      return;
    }
    void openExternal(normalizedUrl).catch((error) => {
      onError?.(error);
    });
  });
}

async function copyExternalLink(url: string): Promise<boolean> {
  try {
    const result = await copyTextToClipboard(url);
    if (!result.success) {
      showCopyFailure();
      return false;
    }
    toast('Link copied');
    return true;
  } catch {
    showCopyFailure();
    return false;
  }
}

function showCopyFailure(): void {
  toast.error('Copy failed', { description: 'The link could not be copied to the clipboard.' });
}

function getActiveTaskView() {
  const ref = getNavigation().currentRef;
  if (ref.viewId !== 'task') return undefined;
  const { projectId, taskId } = ref.params as {
    projectId?: string;
    taskId?: string;
  };
  if (!projectId || !taskId) return undefined;
  return getTaskComposition(projectId, taskId);
}
