import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { useMemo } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import {
  buildAgentGroups,
  getAssumedInstalledAgents,
  type AgentDisableReason,
} from './agent-selector-options';

export function useAgentAvailability({
  connectionId,
  getDisabledReason,
  value,
}: {
  connectionId?: string;
  getDisabledReason?: AgentDisableReason;
  value: AgentProviderId | null;
}) {
  const host = hostRefFromConnectionId(connectionId);
  const { data: agents } = useAgents(host);
  const { data: statuses, install, isInstalling } = useAgentInstallationStatuses(host);

  // [XG-CUSTOM] 远程 host（SSH 项目）：hostDependency 检测不支持远程
  // （getDependencyManager 对 connectionId 直接返回 remoteRuntimeUnavailable），
  // 导致 listAgentInstallationStatus 整体失败 → 所有 agent 被归为 Not installed → 灰。
  // 远程 agent 的依赖在远程 host 上，客户端本就无需检测，全部视为可用。
  const isRemote = Boolean(connectionId);

  const dependencyData = useMemo(() => {
    if (!statuses) return null;
    const result: Record<string, { status: string; category: string }> = {};
    for (const s of statuses) {
      result[s.id] = { status: s.status, category: 'agent' };
    }
    return result;
  }, [statuses]);

  const installedAgents = useMemo(
    () => {
      if (isRemote) {
        // 远程 host：跳过 hostDependency 检测，所有 agent 可选用。
        return (agents ?? []).map((agent) => agent.id);
      }
      return dependencyData
        ? Object.entries(dependencyData)
            .filter(([, state]) => state.category === 'agent' && state.status === 'available')
            .map(([id]) => id)
        : [];
    },
    [isRemote, agents, dependencyData]
  );

  const assumedInstalledAgents = useMemo(
    () => getAssumedInstalledAgents(value, dependencyData),
    [value, dependencyData]
  );

  const installingAgents = new Set<AgentProviderId>();

  const groups = buildAgentGroups(
    agents ?? [],
    installedAgents,
    assumedInstalledAgents,
    installingAgents,
    getDisabledReason
  );

  async function installAgent(agentId: AgentProviderId): Promise<void> {
    return new Promise((resolve) => {
      install({ id: agentId }, { onSettled: () => resolve() });
    });
  }

  return {
    groups,
    dependencyData,
    installingAgents,
    installAgent,
    isInstalling,
  };
}
