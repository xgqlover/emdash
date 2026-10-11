import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

export const preferredConversationTypeSettingsContribution = defineSettingsContribution({
  key: 'preferredConversationType',
  schema: z.enum(['acp', 'pty']),
  // [XG-CUSTOM 2026-10-11] **默认必须是 `acp`（聊天），不能是 `pty`（终端）**。
  //   为什么：上游 `55b972f18`（v1.2.8，2026-09-25「remember the interface choice globally」）
  //   把「聊天界面/终端」从旧的按 host+provider 存储（kv `provider-launch` + 渲染层 localStorage
  //   `initial-conversation:chat-ui-enabled`）**换成了这个全局键，并明确"不迁移、不兼容读"**，
  //   而它给的默认是 `'pty'`。⇒ 老用户库里**没有这个键** ⇒ 每次新建任务都回落**终端** ⇒
  //   终端模式**没有聊天输入框**（真机症状：新任务打不开对话框；两台客户端都中，因为两边都缺键）。
  //   判据链：`use-conversation-launch-settings.ts:35` 是唯一分叉点
  //   （`agentSupportsAcp(caps) && (draft?.useChatUi ?? preferredTransport === 'acp')`），
  //   落到 `build-create-task-params.ts:39` 的 `state.useChatUi ? 'acp' : 'pty'`。
  //   改这里之后：**不支持 ACP 的 provider 不受影响**（上面那道 `agentSupportsAcp` 门仍在）。
  // ⚠️ 同源坑还有一个：`core/features/tasks/node/operations/createTask.ts:258` 的 `ic.type ?? 'pty'`
  //   —— 那是"没给类型时"的第二处 pty 默认，见 `emdash-运行经验-OPS.md`。
  defaults: 'acp' as const,
});
