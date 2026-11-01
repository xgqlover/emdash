import type { HostRef } from '@emdash/core/primitives/host/api';
import type { CatalogSkill } from '@emdash/core/primitives/skills/api';
import type { Result } from '@emdash/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { openModal } from '@core/manifests/browser/modal-api';
import { modalCatalog } from '@core/manifests/browser/modal-catalog';
import type { ModalDismissed } from '@core/primitives/modals/react';

const expectedModalIds = [
  'addProjectModal',
  'addRemoteModal',
  'addSshConnModal',
  'agentSignInModal',
  'commandPaletteModal',
  'confirmActionModal',
  'confirmExternalLinkModal',
  'conflictDialog',
  'createConversationModal',
  'createPrModal',
  'createSkillModal',
  'deleteTaskModal',
  'devProcessPanelModal',
  'directorySelectorModal',
  'feedbackModal',
  'integrationSetupModal',
  'languageServicesDialog',
  'linkConversationModal',
  // [XG-CUSTOM] 2026-10-06 —— 「打开网址」输入框（browser.openUrl 命令用）
  'openUrlModal',
  'projectConfigImportModal',
  'promptModal',
  'quitUnsavedChangesModal',
  'relinkProjectModal',
  'renameProjectModal',
  'renameTaskModal',
  'shareProjectConfigModal',
  'skillDetailModal',
  'taskModal',
  'unsavedChangesModal',
  // [XG-CUSTOM 2026-10-27] Dot 落卡详情（原生弹窗机制）
  'xgCardModal',
] as const;

function openUnsavedChangesForTypeTest() {
  return openModal('unsavedChangesModal', {
    fileName: 'README.md',
  });
}

function openRemoteCreateSkillForTypeTest(host: HostRef) {
  return openModal('createSkillModal', { host });
}

// [XG-CUSTOM 2026-10-27] 类型钉子：props 漂了 typecheck 就红
function openXgCardForTypeTest() {
  return openModal('xgCardModal', {
    path: '知识交换中心/📡 inbox/xiangwo/dot-x.md',
    onOpenFile: () => {},
    onMerge: () => {},
  });
}

function openSkillDetailForTypeTest(skill: CatalogSkill) {
  return openModal('skillDetailModal', {
    skill,
    onInstall: async () => true,
    onUninstall: async () => true,
  });
}

describe('modalCatalog', () => {
  it('contains every modal exactly once', () => {
    const catalogIds = modalCatalog.defs.map((definition) => definition.id).sort();

    expect(catalogIds).toEqual([...expectedModalIds].sort());
  });

  it('infers caller props and outcomes from modal ids', () => {
    expectTypeOf<ReturnType<typeof openXgCardForTypeTest>>().toEqualTypeOf<
      Promise<Result<void, ModalDismissed>>
    >();
    expectTypeOf<ReturnType<typeof openUnsavedChangesForTypeTest>>().toEqualTypeOf<
      Promise<Result<'save' | 'discard', ModalDismissed>>
    >();
    expectTypeOf<ReturnType<typeof openRemoteCreateSkillForTypeTest>>().toEqualTypeOf<
      Promise<Result<void, ModalDismissed>>
    >();
    expectTypeOf<ReturnType<typeof openSkillDetailForTypeTest>>().toEqualTypeOf<
      Promise<Result<void, ModalDismissed>>
    >();
  });
});
