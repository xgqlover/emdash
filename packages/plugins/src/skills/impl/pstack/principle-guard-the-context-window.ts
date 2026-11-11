import { skillDescriptorSchema, type SkillProvider } from '../../types';

/**
 * pstack/principle-guard-the-context-window —— 上下文预算闸（pstack 里只有 519 B，但很硬）。
 * 我们这一层对应的是"回合预算"，比 `kb_map` 的四层更外一层：四层管**取多少知识**，它管**这一回合花多少**。
 */
export const provider: SkillProvider = {
  metadata: { id: 'pstack/principle-guard-the-context-window' },
  skill: skillDescriptorSchema.parse({
    id: 'pstack/principle-guard-the-context-window',
    source: 'pstack',
    upstreamPath: 'skills/principle-guard-the-context-window/SKILL.md',
    description:
      '上下文要满时使用：分阶段限流、给每个阶段设轮次预算、把大输出外包给子代理、只留摘要回主上下文。',
    entry: 'packages/plugins/src/skills/impl/pstack/principle-guard-the-context-window.ts',
    budget: { tokens: 2000 },
    invariants: [
      '大输出不许整段进主上下文，只能摘要 + 指针',
      '每个阶段必须有明确的文件数/回合数上限',
    ],
  }),
};
