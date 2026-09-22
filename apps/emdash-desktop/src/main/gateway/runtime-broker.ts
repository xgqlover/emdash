import {
  hostRefEquals,
  LOCAL_HOST_REF,
  sshConnectionIdOf,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import { isRuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import {
  RuntimeBroker,
  runtimeHostNotConfigured,
  runtimeHostUnavailable,
  type RuntimeClientSource,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Hosts } from '@core/services/hosts/node/hosts';
import { translateHostPreparationError } from '@core/services/hosts/node/runtime-resolution';
import {
  WorkspaceServerProtocolError,
  WorkspaceServerProvisionError,
} from '@core/services/hosts/node/workspace-server';
import type { DesktopRuntimeClients } from './desktop-workers';

export function createDesktopRuntimeBroker(
  clients: DesktopRuntimeClients,
  hosts: Hosts
): RuntimeBroker {
  return new RuntimeBroker({
    resolve: (host) => resolveDesktopRuntimeClient(host, clients, hosts),
  });
}

async function resolveDesktopRuntimeClient(
  host: HostRef,
  clients: DesktopRuntimeClients,
  hosts: Hosts
): Promise<Result<RuntimeClientSource, RuntimeResolveError>> {
  if (!hostRefEquals(host, LOCAL_HOST_REF)) {
    const connectionId = sshConnectionIdOf(host);
    if (connectionId) {
      try {
        const current = hosts.get(host);
        if (!current) return err(runtimeHostNotConfigured(host, 'Host is not managed'));
        // [XG-CUSTOM] 高延迟远程（SSH 异地，ping ~340ms）：首次获取 client 时等待 runtime 就绪，
// 避免 host 还没 ready（连接未建立）就立即抛 runtime-unavailable（Error creating task / Host runtime is unavailable）。
// 本地 host 立即 ready 不受影响；远程会等连接建立（几秒）后再返回。
const connection = await current.runtime.client();
        return ok(
          connection.connection
            ? { client: connection.client, connection: connection.connection }
            : connection.client
        );
      } catch (error) {
        if (isRuntimeResolveError(error)) return err(error);
        if (
          error instanceof WorkspaceServerProvisionError ||
          error instanceof WorkspaceServerProtocolError
        ) {
          return err(translateHostPreparationError(host, 'handshaking', error));
        }
        return err(
          runtimeHostUnavailable(
            host,
            error instanceof Error ? error.message : 'Remote workspace server is unavailable'
          )
        );
      }
    }
    return err(
      host.type === 'remote'
        ? runtimeHostUnavailable(host, 'Remote runtime sessions are not enabled')
        : runtimeHostNotConfigured(host, `Local runtime host '${host.id}' is not configured`)
    );
  }

  return ok({
    git: clients.git,
    fileSearch: clients.fileSearch,
    files: clients.files,
    acp: clients.acp,
    automations: clients.automations,
    conversations: clients.conversations,
    tuiAgents: clients.tuiAgents,
    agentConfig: clients.agentConfig,
    terminals: clients.terminals,
    workspaceRegistry: clients.workspaceRegistry,
    resourceUsage: clients.resourceUsage,
    hostDependencies: clients.hostDependencies,
    hostSettings: clients.hostSettings,
    scripts: clients.scripts,
  });
}
