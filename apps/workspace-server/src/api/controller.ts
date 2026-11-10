import crypto from 'node:crypto';
import net from 'node:net';
import type { HostDependenciesContract } from '@emdash/core/services/host-dependencies/api';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import { getCurrentLogger } from '@emdash/shared/logger';
import { createController, forwardContractImpl, type ContractImpl } from '@emdash/wire/rpc';
import type { ContractClient } from '@emdash/wire/rpc';
import type { WorkspaceServerRuntimeClients } from '../gateway/workspace-workers';
// [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为）
import { xgWire, xgWireFail, xgWireOk } from '../wire/xg-handshake-log';

export type WorkspaceWireControllerDeps = {
  runtimes: WorkspaceServerRuntimeClients;
  hostDependencies: ContractClient<HostDependenciesContract>;
  appVersion?: string;
  daemonId?: string;
  startedAt?: number;
};

const defaultStartedAt = Date.now();
const defaultDaemonId = crypto.randomUUID();
export function createWorkspaceWireController(deps: WorkspaceWireControllerDeps) {
  const appVersion = deps.appVersion ?? '0.0.0';
  const daemonId = deps.daemonId ?? defaultDaemonId;
  const startedAt = deps.startedAt ?? defaultStartedAt;

  return createController(workspaceWireContract, {
    health: () => ({
      status: 'ok' as const,
      version: appVersion,
      uptimeMs: Date.now() - startedAt,
      protocolVersion: PROTOCOL_VERSION,
    }),
    initialize: ({ protocolVersion, client }) => {
      // [XG-CUSTOM 2026-11-05] 握手取证：这是「客户端来问了没有 / 为什么不给 ready」的主判据。
      // `getCurrentLogger()` 在这里会拿到 `serve()` 用 `runWithLogger` 绑好的子 logger
      // ⇒ 日志自带 `wireCallId`（= 线上 reqId）；没绑时退化成 noop。
      // ⛔ 只取白名单字段（协议版本、client.id、client.appVersion），**不打印入参 body**。
      const handshakeStartedAt = Date.now();
      const logger = getCurrentLogger();
      const clientId = client?.id;
      const clientVersion = client?.appVersion;
      xgWire(logger, 'debug', {
        op: 'initialize',
        phase: 'enter',
        protocolVersion,
        serverProtocolVersion: PROTOCOL_VERSION,
        clientId,
        clientVersion,
      });
      const result = negotiateProtocol(protocolVersion, PROTOCOL_VERSION);
      const ms = Date.now() - handshakeStartedAt;
      if (!result.compatible) {
        xgWireFail(logger, {
          op: 'initialize',
          reason: 'protocol-incompatible',
          action: result.action,
          protocolVersion,
          serverProtocolVersion: PROTOCOL_VERSION,
          clientId,
          clientVersion,
          ms,
        });
        return err({
          type: 'protocol-incompatible' as const,
          action: result.action,
          clientProtocolVersion: result.clientProtocolVersion,
          serverProtocolVersion: result.serverProtocolVersion,
        });
      }
      xgWireOk(logger, {
        op: 'initialize',
        agreedVersion: result.agreedVersion,
        agreedMinor: result.agreedMinor,
        protocolVersion,
        serverProtocolVersion: PROTOCOL_VERSION,
        clientId,
        clientVersion,
        ms,
      });
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        agreedVersion: result.agreedVersion,
        agreedMinor: result.agreedMinor,
        server: {
          appVersion,
          daemonId,
          startedAt,
        },
      });
    },
    acp: {
      ...forwardContractImpl(workspaceWireContract.acp, deps.runtimes.acp),
      sendPrompt: (input, meta) =>
        deps.runtimes.acp.sendPrompt(input, { signal: meta.signal, timeoutMs: 0 }),
    },
    providerUsage: forwardContractImpl(
      workspaceWireContract.providerUsage,
      deps.runtimes.providerUsage
    ),
    agentConfig: forwardContractImpl(workspaceWireContract.agentConfig, deps.runtimes.agentConfig),
    automations: forwardContractImpl(workspaceWireContract.automations, deps.runtimes.automations),
    conversations: forwardContractImpl(
      workspaceWireContract.conversations,
      deps.runtimes.conversations
    ),
    fileSearch: forwardContractImpl(workspaceWireContract.fileSearch, deps.runtimes.fileSearch),
    files: forwardContractImpl(workspaceWireContract.files, deps.runtimes.files),
    lsp: forwardContractImpl(workspaceWireContract.lsp, deps.runtimes.lsp),
    git: forwardContractImpl(workspaceWireContract.git, deps.runtimes.git),
    hostSettings: forwardContractImpl(
      workspaceWireContract.hostSettings,
      deps.runtimes.hostSettings
    ),
    scripts: forwardContractImpl(workspaceWireContract.scripts, deps.runtimes.scripts),
    resourceUsage: forwardContractImpl(
      workspaceWireContract.resourceUsage,
      deps.runtimes.resourceUsage
    ),
    terminals: forwardContractImpl(workspaceWireContract.terminals, deps.runtimes.terminals),
    tuiAgents: forwardContractImpl(workspaceWireContract.tuiAgents, deps.runtimes.tuiAgents),
    // Forwarded calls keep each registry verb's own call deadline: the long-running
    // ones (worktree creation, activation, removals, artifact cleaning) declare none in
    // the contract.
    workspaceRegistry: forwardContractImpl(
      workspaceWireContract.workspaceRegistry,
      deps.runtimes.workspaceRegistry
    ),
    hostDependencies: forwardContractImpl(
      workspaceWireContract.hostDependencies,
      deps.hostDependencies
    ),
    portForwards: createPortForwardsController(),
  });
}

function createPortForwardsController(): NonNullable<
  ContractImpl<typeof workspaceWireContract>['portForwards']
> {
  return {
    inspect: async ({ port }) => {
      try {
        const results = await Promise.all([
          probeLoopbackPort('127.0.0.1', port),
          probeLoopbackPort('::1', port),
        ]);
        const families = results.flatMap((result, index) =>
          result ? ([index === 0 ? 'ipv4' : 'ipv6'] as const) : []
        );
        return ok({
          listening: families.length > 0,
          families,
        });
      } catch (error) {
        return err({
          type: 'io' as const,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function probeLoopbackPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => finish(false), 500);
    const finish = (listening: boolean) => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
