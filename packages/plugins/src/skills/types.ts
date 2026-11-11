import z from 'zod';

/**
 * [XG-CUSTOM 2026-10-28] skill 的形状 —— 借 pstack 的 SKILL.md 语义（name / description / 正文），
 * 但**装进 emdash 原生的 plugin 机制**（createPluginRegistry / capability）里，不引入第二套运行时。
 *
 * 三条硬规矩（与 docs/规则/L0.6-MetaHarness-对接-OPS-2026-10-26.md 一致）：
 * 1. 外来的 skill **必须记 upstreamPath**（搬了不记出处 = 下次不知道它是否已被上游改过）；
 * 2. `description` 是给模型看的**触发条件**，不是介绍文案；
 * 3. `entry` 必须是真实存在的文件，登记了不算数，能被找到才算；
 *    **相对基准 = emdash 仓根**（消费方是 emdash；外层仓的路径前缀 `emdash/` 由守卫自己补）。
 */
export const skillDescriptorSchema = z.object({
  id: z.string().min(3),
  source: z.enum(['pstack', 'local']),
  upstreamPath: z.string().optional(),
  description: z.string().min(8),
  entry: z.string().min(1),
  args: z.array(z.string()).default([]),
  budget: z.object({ tokens: z.number().int().positive().optional() }).default({}),
  invariants: z.array(z.string()).default([]),
});

export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;

export type SkillProvider = {
  metadata: { id: string };
  skill: SkillDescriptor;
};
