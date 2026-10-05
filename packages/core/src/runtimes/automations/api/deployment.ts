import { z } from 'zod';
import { hostAbsolutePathSchema, hostFileRefSchema } from '#primitives/path/api';
import {
  acpSessionStartInputSchema,
  tuiSessionStartInputSchema,
} from '#services/session-start/api';

const nonBlankStringSchema = z.string().trim().min(1);

export const automationIdSchema = z.string().min(1);

export const automationGitRemoteSchema = z.object({
  name: nonBlankStringSchema,
  url: nonBlankStringSchema,
});

export const automationGitBranchRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    branch: nonBlankStringSchema,
    remote: automationGitRemoteSchema.optional(),
  }),
  z.object({
    type: z.literal('remote'),
    branch: nonBlankStringSchema,
    remote: automationGitRemoteSchema,
  }),
]);

export const automationWorktreeConfigSchema = z.object({
  kind: z.literal('worktree'),
  repository: hostFileRefSchema,
  worktreePoolPath: hostAbsolutePathSchema,
  baseRemote: nonBlankStringSchema,
  preservePatterns: z.array(nonBlankStringSchema),
  git: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create-branch'),
      fromBranch: automationGitBranchRefSchema,
      pushRemote: nonBlankStringSchema.nullable(),
    }),
    z.object({
      kind: z.literal('use-branch'),
      branchName: nonBlankStringSchema,
    }),
  ]),
});

export const automationDirectoryConfigSchema = z.object({
  kind: z.literal('directory'),
  path: hostFileRefSchema,
});

export const automationWorkspaceConfigSchema = z.discriminatedUnion('kind', [
  automationWorktreeConfigSchema,
  automationDirectoryConfigSchema,
]);

export const automationScheduleSchema = z.object({
  expr: z.string().trim().min(1),
  tz: z.string().trim().min(1),
});

export const automationAcpAgentConfigSchema = z.object({
  type: z.literal('acp'),
  start: acpSessionStartInputSchema.omit({
    mode: true,
    conversationId: true,
    cwd: true,
    sessionId: true,
  }),
  title: nonBlankStringSchema.optional(),
});

export const automationTuiAgentConfigSchema = z.object({
  type: z.literal('tui'),
  start: tuiSessionStartInputSchema.omit({
    conversationId: true,
    cwd: true,
    sessionId: true,
    cols: true,
    rows: true,
  }),
  title: nonBlankStringSchema.optional(),
});

export const automationAgentConfigSchema = z.discriminatedUnion('type', [
  automationAcpAgentConfigSchema,
  automationTuiAgentConfigSchema,
]);

// [XG-CUSTOM 2026-10-05] 事件触发配置：有它 = 这个部署由 webhook 触发（与 `schedule` 互斥）
export const automationWebhookTriggerSchema = z.object({
  token: nonBlankStringSchema,
  /** 受限过滤表达式（见 node/scheduling/webhook-filter.ts）；缺省 = 全匹配 */
  filter: z.string().optional(),
});

export const automationDeploymentSchema = z.object({
  automationId: automationIdSchema,
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  name: nonBlankStringSchema,
  /**
   * cron 计划。[XG-CUSTOM 2026-10-05] **null = 不是 cron 触发**（事件触发的部署没有计划，
   * 调度器见到它会跳过 —— 不能给它排一条假计划）。
   */
  schedule: automationScheduleSchema.nullable(),
  agent: automationAgentConfigSchema,
  workspace: automationWorkspaceConfigSchema,
  /** [XG-CUSTOM 2026-10-05] 事件触发（webhook）配置；只有 kind=webhook 的 automation 才有 */
  webhook: automationWebhookTriggerSchema.optional(),
});

export const automationRunConfigSnapshotSchema = automationDeploymentSchema.pick({
  name: true,
  schedule: true,
  agent: true,
  workspace: true,
});

export type AutomationId = z.infer<typeof automationIdSchema>;
export type AutomationGitRemote = z.infer<typeof automationGitRemoteSchema>;
export type AutomationGitBranchRef = z.infer<typeof automationGitBranchRefSchema>;
export type AutomationWorktreeConfig = z.infer<typeof automationWorktreeConfigSchema>;
export type AutomationDirectoryConfig = z.infer<typeof automationDirectoryConfigSchema>;
export type AutomationWorkspaceConfig = z.infer<typeof automationWorkspaceConfigSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationAcpAgentConfig = z.infer<typeof automationAcpAgentConfigSchema>;
export type AutomationTuiAgentConfig = z.infer<typeof automationTuiAgentConfigSchema>;
export type AutomationAgentConfig = z.infer<typeof automationAgentConfigSchema>;
export type AutomationWebhookTrigger = z.infer<typeof automationWebhookTriggerSchema>;
export type AutomationDeployment = z.infer<typeof automationDeploymentSchema>;
export type AutomationRunConfigSnapshot = z.infer<typeof automationRunConfigSnapshotSchema>;
