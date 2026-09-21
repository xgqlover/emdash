import { createConversationModal } from '../browser/create-conversation-modal';
// [XG-CUSTOM] 专家交接平台弹窗
import { expertHandoffModal } from '../browser/expert-handoff-modal';

export const conversationsBrowserContributions = {
  modalDefs: [createConversationModal, expertHandoffModal],
} as const;
