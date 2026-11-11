import { createPluginRegistry } from '@emdash/shared/plugins';

import { provider as createVerification } from './impl/pstack/create-verification-skill';
import { provider as encodeLessons } from './impl/pstack/principle-encode-lessons-in-structure';
import { provider as guardContext } from './impl/pstack/principle-guard-the-context-window';
import type { SkillProvider } from './types';

/**
 * 用 **emdash 原生的** `createPluginRegistry` 装 skill —— 与 13 个 integration、2 个 agent adapter 同一套。
 * 不另造命令表：`/命令` 只是这些 skill 的一个触发词，不是第二套真源。
 */
export const skillPluginRegistry = createPluginRegistry<SkillProvider>();

for (const provider of [createVerification, encodeLessons, guardContext]) {
  skillPluginRegistry.register(provider);
}
