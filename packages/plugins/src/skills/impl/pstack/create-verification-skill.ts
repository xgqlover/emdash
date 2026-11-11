import { skillDescriptorSchema, type SkillProvider } from '../../types';

/**
 * pstack/create-verification-skill —— **把"怎么验这个系统"写成一个可被 agent 调用的技能**。
 *
 * 借的核心是它的四段结构与五问：
 *   Interview the repo, not the user → Surface / Run / Drive / Observe / Isolate
 *   → 产出 Launch / Doctor / Drive / Evidence
 * 我们的用法：给一个子系统（例如 kb 门、L0.6）生成**带 doctor 与证据标准**的守卫 SKILL，
 * 而不是又写一个只跑一次就忘的脚本。
 */
export const provider: SkillProvider = {
  metadata: { id: 'pstack/create-verification-skill' },
  skill: skillDescriptorSchema.parse({
    id: 'pstack/create-verification-skill',
    source: 'pstack',
    upstreamPath: 'skills/create-verification-skill/SKILL.md',
    description:
      '为一个子系统生成可被 agent 调用的验证技能：先回答 Surface/Run/Drive/Observe/Isolate 五问，' +
      '再产出 Launch/Doctor/Drive/Evidence 四段；严禁驱动内部 setter，只走真实用户路径。',
    entry: 'packages/plugins/src/skills/impl/pstack/create-verification-skill.ts',
    args: ['subsystem'],
    invariants: [
      '五问必须从代码回答，问不出来的才问人',
      '必须有一项 read-only 的 doctor，回答"这个实例值不值得驱动"',
      '证据必须是真实用户路径的截图/转录/回包，不是内部状态',
    ],
  }),
};
