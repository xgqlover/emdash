// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
import { definePlugin, registerPluginBehavior } from '@emdash/core/services/agent-plugins/api/plugins';
import { passthroughMcpAdapter } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from '../xiangwo/icon';
import { enrichXiangwoUpdate } from '../xiangwo/acp-transform';

export const plugin = definePlugin(
  {
    id: 'xiangwo-dayi',
    name: '大翼航天',
    description: '大翼航天 bot（独立 persona + 记忆 + 工作文件夹），项我 @dayi 路由',
  },
  {
    prompt: { kind: 'none' },
    acp: { kind: 'supported', supportedTransports: ['stdio'] },
    sessions: { kind: 'resumable' },
    // [XG-CUSTOM] 声明 MCP 能力：bot 聊天窗读 WeKnora MCP server
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    hostDependency: { id: 'xiangwo-dayi', binaryNames: ['/usr/bin/python3'] },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  // [XG-CUSTOM] MCP 配置共用 ~/.xiangwo/mcp.json
  mcp: passthroughMcpAdapter('.xiangwo/mcp.json'),
  acp: {
    ...createNativeAcpBehavior(() => ({
    command: '/usr/bin/python3',
    args: ['/persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo_acp.py'],
    env: { XIANGWO_BOT: 'dayi' },
  })),
    // [XG-CUSTOM] 专家 spawn → 原生 subagent 行
    enrich: enrichXiangwoUpdate,
  },
});
