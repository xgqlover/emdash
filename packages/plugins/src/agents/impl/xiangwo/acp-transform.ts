// [XG-CUSTOM] 项我子代理 enrich（见 CUSTOMIZATIONS.md）
// 把 xiangwo_acp.py 发的「专家 spawn」工具调用（_meta.xiangwo.subagent=true）
// 提升为 emdash 原生 subagent 事件，让聊天窗显示「子代理行」（运行中/完成/后台）。
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/runtimes/acp/api';

type XiangwoMeta = {
  xiangwo?: {
    subagent?: boolean;
    agentId?: string;
    background?: boolean;
    inputSummary?: string;
  };
};

export function enrichXiangwoUpdate(update: NormalizedEvent, raw: SessionUpdate): NormalizedEvent {
  if (update.kind !== 'tool_call' && update.kind !== 'tool_call_update') return update;
  const meta = (raw._meta as XiangwoMeta | null | undefined)?.xiangwo;
  if (!meta?.subagent) return update;

  // 专家 spawn 工具调用 → 原生 subagent 事件
  if (update.kind === 'tool_call') {
    return {
      kind: 'subagent',
      toolCallId: update.toolCallId,
      title: update.title,
      status: update.status,
      parentToolCallId: update.parentToolCallId,
      inputSummary: meta.inputSummary ?? update.inputSummary,
      background: meta.background ?? false,
      agentId: meta.agentId,
    };
  }
  return update;
}
