import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'better-sqlite3': resolve(
        __dirname,
        '../../apps/emdash-desktop/tooling/node-deps/node_modules/better-sqlite3'
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // [XG-CUSTOM 2026-10-09] 让技能测试**封闭**：skills.ts 会按 EMDASH_CENTRAL_SKILLS_ROOT /
    // EMDASH_USER_SKILLS_ROOT 去读真实技能库（本机 = 中央库 940 个），
    // 于是 runtime.test.ts 的「creates and removes local skills」在本机会拿到 942 条而不是 1 条
    // （HEAD 基线同样失败：断言 length 1 vs 942 / 5s 超时）。指向空目录后测试才与主机无关。
    env: {
      EMDASH_CENTRAL_SKILLS_ROOT: resolve(__dirname, 'test-fixtures/empty-skills-central'),
      EMDASH_USER_SKILLS_ROOT: resolve(__dirname, 'test-fixtures/empty-skills-user'),
    },
  },
});
