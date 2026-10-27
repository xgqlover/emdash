import { createConversationModal } from '../browser/create-conversation-modal';
// [XG-CUSTOM] 专家交接平台弹窗
import { expertHandoffModal } from '../browser/expert-handoff-modal';

export const conversationsBrowserContributions = {
// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
  modalDefs: [createConversationModal, expertHandoffModal],
} as const;
