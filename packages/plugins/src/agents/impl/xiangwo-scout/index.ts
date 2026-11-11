// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
import { definePlugin, registerPluginBehavior } from '@emdash/core/services/agent-plugins/api/plugins';
import { passthroughMcpAdapter } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from '../xiangwo/icon';
import { enrichXiangwoUpdate } from '../xiangwo/acp-transform';

export const plugin = definePlugin(
  {
    id: 'xiangwo-scout',
    name: '趋势侦察',
    description: 'scout bot（趋势研究员；独立 persona + 记忆 + 工作文件夹），项我 @scout 路由',
    websiteUrl: '',
  },
  {
    prompt: { kind: 'none' },
    acp: { kind: 'supported' },
    sessions: { kind: 'resumable' },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    hostDependency: { id: 'xiangwo-scout', binaryNames: ['python3', 'cmd'] },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  mcp: passthroughMcpAdapter('.xiangwo/mcp.json'),
  acp: {
    ...createNativeAcpBehavior(() => ({
      command: 'python3',
      args: ['/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo_acp.py'],
      env: { XIANGWO_BOT: 'scout' },
    })),
    enrich: enrichXiangwoUpdate,
  },
});
