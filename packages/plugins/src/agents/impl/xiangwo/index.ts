// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { passthroughMcpAdapter } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { enrichXiangwoUpdate } from './acp-transform';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'xiangwo',
    name: '项我',
    description: '项我多 bot 对话（R0 直接答 / R1 蜂群 / R2 本地规则），8900 OpenAI 接口，ACP 接入',
    websiteUrl: '',
  },
  {
    prompt: { kind: 'none' },
    acp: {
      kind: 'supported',
    },
    sessions: {
      kind: 'resumable',
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    // [XG-CUSTOM] 无 installCommands：加 installCommands(method 'other') 会被判「不可安装」→ 全灰。
    // 09-17 快照（bot 可用）就是只声明 binaryNames，不加 installCommands。
    hostDependency: {
      id: 'xiangwo',
      binaryNames: ['python3', 'cmd'],
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  mcp: passthroughMcpAdapter('.xiangwo/mcp.json'),
  acp: {
    ...createNativeAcpBehavior(() => ({
      command: 'python3',
      args: ['/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo_acp.py'],
      env: {},
    })),
    // [XG-CUSTOM] 专家 spawn → 原生 subagent 行
    enrich: enrichXiangwoUpdate,
  },
});
