import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';
import { taskConfig } from '@core/primitives/tasks/api';
import { workspaceConfig } from '@core/primitives/workspaces/api';

// [XG-CUSTOM 2026-10-05] **trigger 升 v2：cron | webhook**（治"触发源只有 cron"）
//
// 形状取舍（有意为之）：**不用判别联合**，而是一个宽松对象 + `kind` 默认 `'cron'`。
// 理由：判别联合让 `TriggerConfig` 的**输出类型**丢掉 `expr`/`tz`，会连累 8 个既有调用点
// （builtin-catalog / useAutomationFormState / AutomationRow / validation / automations-service /
// deployment-builder …）全部报 TS2339 —— 为了加一个触发源去改一圈读代码不划算。
// 现在的形状：`kind` 有默认值 ⇒ **旧数据 `{expr,tz}` 与旧写入方原样可用**（读出来 kind='cron'），
// 而 `.expr`/`.tz` 仍在类型里 ⇒ 既有调用点零改动。语义约束交给 `validateTriggerConfig()`。
export const triggerConfigSchema = z.object({
  /** 触发源：缺省 = cron（**兼容旧数据与旧写入方**：它们只写 {expr,tz}）/ webhook（事件）。
   *  判定统一走 `isWebhookTrigger()`，别自己判 `kind === 'cron'`（要处理 undefined）。 */
  kind: z.enum(['cron', 'webhook']).optional(),
  /** cron 触发：表达式（webhook 触发时忽略） */
  expr: z.string().optional(),
  tz: z.string().optional(),
  /**
   * webhook 触发：**每个 automation 一个随机 token**（照仓库 `TuiHookServer` 的姿态：
   * 只有带对 token 的请求才受理 —— 否则本机任意进程都能触发一次 agent 运行）。
   */
  token: z.string().optional(),
  /** webhook 触发：对 payload 的受限过滤表达式（见 scheduling/webhook-filter.ts），**不匹配就不跑** */
  filter: z.string().optional(),
  /** webhook 触发：可选，用 `{{payload}}` 把事件载荷注进 prompt */
  promptTemplate: z.string().optional(),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

/**
 * 语义校验（形状之外的那部分）：cron 必须有 `expr`；webhook 必须有足够长的 `token`。
 * 返回 null = 合法；返回字符串 = 人话原因（给表单/服务端复用）。
 */
export function validateTriggerConfig(config: TriggerConfig): string | null {
  if (config.kind === 'webhook') {
    if (!config.token || config.token.trim().length < 8) {
      return '事件触发需要一个长度 ≥8 的 token（否则本机任何进程都能触发它）';
    }
    return null;
  }
  if (!config.expr || config.expr.trim() === '') return 'cron 触发需要 cron 表达式';
  return null;
}

/** 事件触发？ */
export function isWebhookTrigger(config: TriggerConfig): boolean {
  return config.kind === 'webhook';
}

/** cron 触发？（含"没有 kind 字段"的历史数据/旧写入方） */
export function isCronTrigger(config: TriggerConfig): boolean {
  return config.kind !== 'webhook';
}

export const automationTriggerConfig = defineVersionedSchema()
  .unversioned(triggerConfigSchema)
  .build();

export const conversationConfigSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  title: z.string().optional(),
  autoApprove: z.boolean(),
  /** Model to pass to the agent CLI. Absent or empty string means use the CLI default. */
  model: z.string().optional(),
  /** Conversation transport: 'pty' for terminal or 'acp' for structured chat UI. */
  type: z.enum(['pty', 'acp']).optional(),
});

export type ConversationConfig = z.infer<typeof conversationConfigSchema>;

export const automationConversationConfig = defineVersionedSchema()
  .unversioned(conversationConfigSchema)
  .build();

const storedAutomationTaskConfigV1Schema = z.object({
  version: z.literal('1'),
  taskConfig: taskConfig.asNested(),
  workspaceConfig: workspaceConfig.asNested(),
});

export const storedAutomationTaskConfig = defineVersionedSchema()
  .initial('1', storedAutomationTaskConfigV1Schema)
  .build();

export const storedAutomationTaskConfigSchema = storedAutomationTaskConfig.schema;
export type StoredAutomationTaskConfig = typeof storedAutomationTaskConfig.Type;
