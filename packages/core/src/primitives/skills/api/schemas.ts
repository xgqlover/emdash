import { z } from 'zod';

export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().optional(),
});

export const catalogSkillSchema = z.object({
  id: z.string(),
  installId: z.string().optional(),
  displayName: z.string(),
  description: z.string(),
  // [XG-CUSTOM 2026-10-09] 加 'central'（中央技能库只读来源）
  source: z.enum(['openai', 'anthropic', 'skillssh', 'local', 'central']),
  sourceUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  brandColor: z.string().optional(),
  defaultPrompt: z.string().optional(),
  sourceRef: z.string().optional(),
  catalogSkillId: z.string().optional(),
  skillShPath: z.string().optional(),
  installs: z.number().optional(),
  skillMdContent: z.string().optional(),
  frontmatter: skillFrontmatterSchema,
  installed: z.boolean(),
  localPath: z.string().optional(),
  // [XG-CUSTOM 2026-10-09] 外部只读来源标记（中央库 / User 层）
  readOnly: z.boolean().optional(),
});

export const catalogIndexSchema = z.object({
  version: z.number(),
  lastUpdated: z.string(),
  skills: z.array(catalogSkillSchema),
});

export const skillInstallPayloadSchema = z.object({
  id: z.string(),
  installId: z.string().optional(),
  skillMdContent: z.string(),
  // [XG-CUSTOM 2026-10-09] 同样加 'central'（保持与 catalogSkillSchema 的 source 联合一致）
  source: z.enum(['openai', 'anthropic', 'skillssh', 'local', 'central']).optional(),
  sourceRef: z.string().optional(),
  catalogSkillId: z.string().optional(),
  skillShPath: z.string().optional(),
  iconUrl: z.string().optional(),
});

export const createSkillInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  content: z.string().optional(),
});
