import { createShellEnvManager } from '@emdash/core/services/shell-env/node';
import { createScope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { createWorkspaceWireController } from './api/controller';
import {
  formatWorkspaceServerConfigError,
  loadWorkspaceServerConfig,
  type WorkspaceServerConfig,
} from './config';
import { daemonPaths } from './daemon/paths';
import { removePidFile, writePidFile } from './daemon/pid-file';
import { startDaemon } from './daemon/start';
import { statusDaemon } from './daemon/status';
import { stopDaemon } from './daemon/stop';
import { createWorkspaceServerRuntimeHost } from './gateway/workspace-workers';
// [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为）
import { xgWireFail, xgWireOk } from './wire/xg-handshake-log';
import { serveSocket } from './wire/serve-socket';
import { serveStdio } from './wire/serve-stdio';

type Disposable = {
  dispose(): void | Promise<void>;
};

async function main(): Promise<void> {
  const logger = initProcessLogging({ name: 'workspace-server' });
  const config = loadWorkspaceServerConfig();
  if (!config.success) {
    throw new Error(formatWorkspaceServerConfigError(config.error));
  }

  switch (config.data.command) {
    case 'serve': {
      const active = await serve(config.data, logger);
      installSignalHandlers(active);
      break;
    }
    case 'start':
      await runStart(config.data);
      break;
    case 'stop':
      await runStop(config.data);
      break;
    case 'status':
      await runStatus(config.data);
      break;
  }
}

async function serve(config: WorkspaceServerConfig, logger: Logger): Promise<Disposable> {
  const scope = createScope({
    label: config.serve.kind === 'socket' ? 'workspace-server' : 'workspace-server-stdio',
  });
  try {
    const shellEnv = createShellEnvManager({ target: process.env, logger });
    void shellEnv.refresh().catch((error: unknown) => {
      logger.warn('[shell-env] Unexpected initial capture failure', { error });
    });
    const runtimeHost = await createWorkspaceServerRuntimeHost({
      scope,
      socketPath: config.serve.kind === 'socket' ? config.serve.path : undefined,
      shellEnv,
      logger,
    });
    // [XG-CUSTOM 2026-11-05] 服务端「就绪」的两个阶段点：
    // ① workers 全部 spawn 完成（runtime host 建好）② socket 开始 listen。
    // 客户端面板的 `Stopped` 若与这两行对不上，就说明「客户端压根没连到这台服务端」。
    xgWireOk(logger, { op: 'runtime-ready', reason: 'runtime-host-ready' });
    const controller = createWorkspaceWireController({
      appVersion: config.appVersion,
      runtimes: runtimeHost.runtimes,
      hostDependencies: runtimeHost.hostDependencies,
    });

    if (config.serve.kind !== 'socket') {
      const dispose = serveStdio(controller);
      scope.add(dispose);
      process.stderr.write('workspace-server wire stdio listening\n');
      return { dispose: () => scope.dispose() };
    }

    const handle = await serveSocket(controller, { socketPath: config.serve.path, logger });
    scope.add(() => handle.dispose());
    const paths = daemonPaths(handle.socketPath);
    try {
      await writePidFile(paths.pidPath);
    } catch (error) {
      await scope.dispose();
      throw error;
    }
    process.stderr.write(`workspace-server wire socket listening at ${handle.socketPath}\n`);
    return {
      async dispose() {
        await removePidFile(paths.pidPath);
        await scope.dispose();
      },
    };
  } catch (error) {
    // [XG-CUSTOM 2026-11-05] 启动失败 = 服务端从未就绪，必须留一条 warn（原来只有 stderr 一行）。
    xgWireFail(logger, {
      op: 'runtime-ready',
      reason: 'startup-failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
    });
    await scope.dispose();
    throw error;
  }
}

async function runStart(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('start only supports socket mode');
  const result = await startDaemon({ socketPath: config.serve.path });
  if (!result.success) throw new Error(result.error.message);
  process.stdout.write(
    `workspace-server daemon ${result.data.status} at ${result.data.paths.socketPath}\n`
  );
}

async function runStop(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('stop only supports socket mode');
  const result = await stopDaemon({ socketPath: config.serve.path });
  if (!result.success) throw new Error(result.error.message);
  process.stdout.write(
    result.data.status === 'stopped'
      ? `workspace-server daemon stopped at ${result.data.paths.socketPath}\n`
      : `workspace-server daemon not running at ${result.data.paths.socketPath}\n`
  );
}

async function runStatus(config: WorkspaceServerConfig): Promise<void> {
  if (config.serve.kind !== 'socket') throw new Error('status only supports socket mode');
  const result = await statusDaemon(config.serve.path);
  if (!result.success) {
    process.stderr.write(
      `workspace-server daemon ${result.error.type} at ${result.error.paths.socketPath}: ${result.error.message}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `workspace-server daemon running at ${result.data.paths.socketPath} ` +
      `(version ${result.data.health.version}, uptime ${result.data.health.uptimeMs}ms)\n`
  );
}

function installSignalHandlers(active: Disposable): void {
  let disposing = false;
  const disposeAndExit = (signal: NodeJS.Signals): void => {
    if (disposing) return;
    disposing = true;
    Promise.resolve(active.dispose()).finally(() => {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  };
  process.once('SIGINT', disposeAndExit);
  process.once('SIGTERM', disposeAndExit);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `workspace-server failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
