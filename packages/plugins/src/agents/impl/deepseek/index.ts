// [XG-CUSTOM 2026-10-26] DeepSeek（dsh）—— 官方卖点③「自带 CLI agent」的第一个真接入样本
// 依据：2026-10-26 实测 `dsh --profile acp` 是标准 ACP agent（protocolVersion 1），
//   initialize → newSession → prompt 全通，sessionCapabilities = close/list/resume。
// 台账：emdash/scripts/xg-custom/manifest.json
import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { npmDependency } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description:
      'DeepSeek Harness（dsh）——以 ACP 协议接入的 DeepSeek 官方 CLI coding agent，自带会话续接与子代理。',
    websiteUrl: 'https://github.com/deepseek-ai/deepseek-harness',
  },
  {
    // 提示词走 ACP 协议（connection.prompt），不拼 argv —— 与 xiangwo 同形
    prompt: { kind: 'none' },
    acp: {
      kind: 'supported',
    },
    sessions: {
      kind: 'resumable',
    },
    // 只声明 binaryNames（不写 installCommands 的 method 'other'，否则会被判「不可安装」→ 整个灰掉）
    hostDependency: npmDependency({
      id: 'deepseek',
      package: '@deepseek-ai/dsh',
      binaryNames: ['dsh'],
    }),
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  // dsh 的 ACP surface 是一个 profile：`dsh --profile acp`（patch 了 @deepseek-ai/dsh-acp-app）
  acp: createNativeAcpBehavior(() => ({
    args: ['--profile', 'acp'],
    env: {},
  })),
});