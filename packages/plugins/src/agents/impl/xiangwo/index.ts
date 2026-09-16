// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { enrichXiangwoUpdate } from './acp-transform';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'xiangwo',
    name: '项我',
    description: '项我多 bot 对话（R0 直接答 / R1 蜂群 / R2 本地规则），8900 OpenAI 接口，ACP 接入',
  },
  {
    prompt: { kind: 'none' },
    acp: {
      kind: 'supported',
      supportedTransports: ['stdio'],
    },
    sessions: {
      kind: 'resumable',
    },
    hostDependency: {
      id: 'xiangwo',
      binaryNames: ['python3'],
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
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
