import { skillDescriptorSchema, type SkillProvider } from '../../types';

/**
 * pstack/principle-encode-lessons-in-structure —— 我们已经**引用过它**的那条
 * （`docs/规则/L0.6-MetaHarness-对接-OPS-2026-10-26.md`："规则不从散文来，从账本/日志的证据来"）。
 * 这里把它从"文档里的一句话"变成**可被调用、可被判据检查**的能力。
 */
export const provider: SkillProvider = {
  metadata: { id: 'pstack/principle-encode-lessons-in-structure' },
  skill: skillDescriptorSchema.parse({
    id: 'pstack/principle-encode-lessons-in-structure',
    source: 'pstack',
    upstreamPath: 'skills/principle-encode-lessons-in-structure/SKILL.md',
    description:
      '当同一条提醒出现第二次、或发现自己又要重复一遍同样的话时使用：把它变成结构性约束（守卫/规则/类型），' +
      '不要只把指令写得更醒目；如果修法可以是结构性的，就只用结构性修法。',
    entry: 'packages/plugins/src/skills/impl/pstack/principle-encode-lessons-in-structure.ts',
    invariants: [
      '同一提醒第二次出现 ⇒ 必须先建守卫或规则，再谈文案',
      '结构性修法可用时，不许用"加强提示"代替',
    ],
  }),
};
