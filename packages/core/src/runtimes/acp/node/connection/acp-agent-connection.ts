import type { Client, McpCapabilities, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import type { InitializeFailedError, NormalizedEvent, SpawnFailedError } from '#runtimes/acp/api';
import { acpErr, decodeSessionUpdate } from '#runtimes/acp/api';
import type { AcpProcessHandle, AcpProcessHost } from '#runtimes/acp/api/transport';
import type {
  AcpAgentApi,
  AgentHostAcpSpawn,
  IAcpBehavior,
} from '#services/agent-plugins/api/plugins';

type AcpAgentProcessHost = Pick<AcpProcessHost, 'spawn' | 'spawnTerminal'>;

type ProcessClosed =
  | {
      kind: 'exit';
      exitCode: number | null;
    }
  | {
      kind: 'error';
      error: Error;
      exitCode: number | null;
    };

export type AcpConnectionError = SpawnFailedError | InitializeFailedError;
export type AcpSessionUpdateNormalizer = (raw: SessionUpdate) => NormalizedEvent;

// [XG-CUSTOM 2026-11-02] **initialize 必须有死线 + 必须有"agent 到底说没说话"的证据。**
//   病：`Promise.race([initialize, processClosed])` 里**只有**"进程退出"这一个出口 ⇒
//   请求没送达 / agent 不说话时既不报错也不退出，静默挂到客户端 21s 超时
//   （实测 665 次 `Timed out attaching ACP session`，服务端 0 条错误）。
//   现在改三条：① 8s 硬超时；② 2s 首字节死线（拿不到 = `spawn-stdio-dead`）；
//   ③ 失败时把 stdout 字节数 / 首字节时刻 / stderr 尾巴 / spawnPid 一起打出来。
//   ⚠️ 两个超时都可 env 覆盖：`XG_ACP_INIT_TIMEOUT_MS` / `XG_ACP_FIRST_BYTE_TIMEOUT_MS`。
const DEFAULT_INITIALIZE_TIMEOUT_MS = 8_000;
const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 2_000;
/** How often the stdout byte counter is sampled while initialize is in flight. */
const STDOUT_PROBE_INTERVAL_MS = 100;
/** Characters of stderr kept for the failure payload. */
const STDERR_TAIL_CHARS = 200;
/** Hard cap on the stderr ring buffer (the tail is sliced out of it on demand). */
const STDERR_BUFFER_CHARS = 8_192;
/** Command/arg text is truncated before logging so one bad arg cannot flood the log. */
const MAX_LOGGED_ARG_CHARS = 200;

/** Stable failure prefixes — a failure must never look like ordinary text. */
const STDIO_DEAD_PREFIX = 'spawn-stdio-dead';
const INIT_TIMEOUT_PREFIX = 'initialize-timeout';

/** Live connection to one spawned agent process. */
export interface AcpAgentConnection {
  agent: AcpAgentApi;
  normalize: AcpSessionUpdateNormalizer;
  supportsLoadSession: boolean;
  mcpCapabilities: Required<Pick<McpCapabilities, 'http' | 'sse'>>;
}

/**
 * Spin up an agent process, initialize it, and return a ready connection.
 * Setup failures are reported as Result errors; `onClosed` is reserved for
 * unexpected exits after the connection is ready.
 */
export async function createAcpAgentConnection(
  deps: {
    host: AcpAgentProcessHost;
    behavior: IAcpBehavior;
    logger?: Logger;
  },
  args: {
    providerId: string;
    spawn: AgentHostAcpSpawn;
    scope: Scope;
    /** Factory called once; the runtime passes its buildAgentClient result here. */
    buildClient: (agent: AcpAgentApi, normalize: AcpSessionUpdateNormalizer) => Client;
    /** Called when a ready process exits unexpectedly. */
    onClosed: (exitCode: number | null) => void;
  }
): Promise<Result<AcpAgentConnection, AcpConnectionError>> {
  const { providerId, spawn, scope, buildClient, onClosed } = args;
  const { host, behavior, logger = noopLogger } = deps;
  const connectionScope = scope.child(`acp-connection:${providerId}`);

  let handle: AcpProcessHandle;
  try {
    handle = await host.spawn({
      command: spawn.command,
      args: spawn.args,
      env: spawn.env,
      cwd: spawn.cwd,
    });
  } catch (e) {
    await connectionScope.dispose();
    return acpErr.spawnFailed(toSerializedError(e));
  }

  // [XG-CUSTOM 2026-11-02] stderr 只打 debug 时失败现场是空的 ⇒ 同时留一份尾巴给失败负载。
  const stderrTail = createStderrTail();
  if (handle.stderr) {
    const onStderr = (data: Buffer): void => {
      const text = data.toString();
      stderrTail.push(text);
      logger.debug('createAcpAgentConnection: agent stderr', { text: text.trim() });
    };
    handle.stderr.on('data', onStderr);
    connectionScope.add(() => {
      handle.stderr?.off?.('data', onStderr);
      handle.stderr?.removeListener?.('data', onStderr);
    });
  }

  connectionScope.add(async () => {
    try {
      await handle.kill('SIGTERM');
    } catch {
      // Ignore teardown errors; process may have already exited.
    }
  });

  const processClosed = onceProcessClosed(handle, logger);

  const normalize = (raw: SessionUpdate): NormalizedEvent => {
    const base = decodeSessionUpdate(raw);
    return behavior.enrich ? behavior.enrich(base, raw) : base;
  };

  let connection: AcpAgentApi;
  try {
    connection = behavior.connect({ stdin: handle.stdin, stdout: handle.stdout }, (agent) =>
      buildClient(agent, normalize)
    );
  } catch (e) {
    await connectionScope.dispose();
    return acpErr.initializeFailed(toSerializedError(e));
  }

  const initializeTimeoutMs = readTimeoutEnv(
    'XG_ACP_INIT_TIMEOUT_MS',
    DEFAULT_INITIALIZE_TIMEOUT_MS
  );
  const firstByteTimeoutMs = readTimeoutEnv(
    'XG_ACP_FIRST_BYTE_TIMEOUT_MS',
    DEFAULT_FIRST_BYTE_TIMEOUT_MS
  );
  // Sampled from `handle.stdoutBytes` (a plain counter) so it never touches the stream
  // the SDK is reading — attaching a 'data' listener here would steal frames.
  const probe = startStdoutProbe(handle);
  const dispatchAt = Date.now();
  const diagnostics = (): Record<string, unknown> => ({
    providerId,
    command: redactDiagnosticText(spawn.command),
    args: (spawn.args ?? []).map(redactDiagnosticText),
    cwd: spawn.cwd,
    spawnPid: handle.pid ?? null,
    timeoutMs: initializeTimeoutMs,
    firstByteTimeoutMs,
    stdoutBytes: probe.stdoutBytes,
    stdoutFirstByteAtMs: probe.firstByteAt === null ? null : probe.firstByteAt - dispatchAt,
    stdoutProbe: probe.supported ? 'bytes-read' : 'unsupported',
    elapsedMs: Date.now() - dispatchAt,
    stderrTail: stderrTail.tail(STDERR_TAIL_CHARS),
  });

  const deadlines = createInitializeDeadlines({
    probe,
    initializeTimeoutMs,
    firstByteTimeoutMs,
    logger,
    diagnostics,
    exitCode: () => handle.exitCode,
  });

  try {
    const initialized = await Promise.race([
      initializeAgent(connection, host),
      processClosed.then(failClosedBeforeReady),
      deadlines.promise,
    ]);
    const supportsLoadSession = initialized.agentCapabilities?.loadSession === true;
    const mcpCapabilities = {
      http: initialized.agentCapabilities?.mcpCapabilities?.http === true,
      sse: initialized.agentCapabilities?.mcpCapabilities?.sse === true,
    };
    logger.debug('createAcpAgentConnection: initialized', {
      supportsLoadSession,
      mcpCapabilities,
      stdoutBytes: probe.stdoutBytes,
      stdoutFirstByteAtMs: probe.firstByteAt === null ? null : probe.firstByteAt - dispatchAt,
    });
    void processClosed.then((closed) => {
      if (connectionScope.disposed) return;
      onClosed(exitCodeFromClosed(closed));
    });
    return ok({ agent: connection, normalize, supportsLoadSession, mcpCapabilities });
  } catch (e) {
    logger.error('createAcpAgentConnection: initialize failed', {
      error: e instanceof Error ? e.message : String(e),
      ...diagnostics(),
    });
    await connectionScope.dispose();
    return acpErr.initializeFailed(toSerializedError(e));
  } finally {
    deadlines.cancel();
    probe.dispose();
  }
}

function onceProcessClosed(handle: AcpProcessHandle, logger: Logger): Promise<ProcessClosed> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (closed: ProcessClosed): void => {
      if (settled) return;
      settled = true;
      resolve(closed);
    };

    handle.onExit((exitCode) => {
      settle({ kind: 'exit', exitCode });
    });
    handle.onError((error) => {
      logger.error('createAcpAgentConnection: agent process error', { error: error.message });
      settle({ kind: 'error', error, exitCode: handle.exitCode });
    });
  });
}

function initializeAgent(agent: AcpAgentApi, host: AcpAgentProcessHost) {
  return agent.initialize({
    protocolVersion: 1,
    clientInfo: { name: 'emdash', version: '1' },
    clientCapabilities: {
      ...{ session: { configOptions: { boolean: {} } } },
      fs: { readTextFile: true, writeTextFile: true },
      terminal: typeof host.spawnTerminal === 'function',
    },
  });
}

function failClosedBeforeReady(closed: ProcessClosed): never {
  if (closed.kind === 'error') throw closed.error;
  throw new Error(
    `ACP agent process exited before initialize completed (code ${closed.exitCode ?? 'null'})`
  );
}

function exitCodeFromClosed(closed: ProcessClosed): number | null {
  return closed.exitCode;
}

// ---------------------------------------------------------------------------
// [XG-CUSTOM 2026-11-02] initialize 死线 + stdio 自检
// ---------------------------------------------------------------------------

type StdoutProbe = {
  /** True when the host reports a real byte counter (fake/unsupported streams report null). */
  readonly supported: boolean;
  /** Bytes received on stdout since spawn. */
  readonly stdoutBytes: number;
  /** Epoch ms of the first observed stdout byte, or null when the agent stayed silent. */
  readonly firstByteAt: number | null;
  dispose(): void;
};

/**
 * Watch the agent's stdout without consuming it.
 *
 * `handle.stdout` is read by the ACP SDK; adding a `'data'` listener would move the
 * stream to flowing mode and steal frames. The host therefore exposes a plain byte
 * counter (`AcpProcessHandle.stdoutBytes`) and we only sample that.
 */
function startStdoutProbe(handle: AcpProcessHandle): StdoutProbe {
  let supported = false;
  let total = 0;
  let firstByteAt: number | null = null;

  const sample = (): void => {
    const seen = readStdoutBytes(handle);
    if (seen === null) return;
    supported = true;
    if (seen > total) {
      if (firstByteAt === null && total === 0) firstByteAt = Date.now();
      total = seen;
    }
  };
  sample();
  const timer = setInterval(sample, STDOUT_PROBE_INTERVAL_MS);
  timer.unref?.();

  return {
    get supported() {
      return supported;
    },
    get stdoutBytes() {
      sample();
      return total;
    },
    get firstByteAt() {
      return firstByteAt;
    },
    dispose() {
      clearInterval(timer);
    },
  };
}

function readStdoutBytes(handle: AcpProcessHandle): number | null {
  if (typeof handle.stdoutBytes === 'number' && Number.isFinite(handle.stdoutBytes)) {
    return handle.stdoutBytes;
  }
  return null;
}

/**
 * Rejects with a tagged Error when the initialize handshake stops making progress.
 *
 * Two distinct failures, because they point at different culprits:
 * - no stdout byte within `firstByteTimeoutMs` ⇒ `spawn-stdio-dead` (the agent never spoke:
 *   the request never reached it, or its stdio is not connected as a pair);
 * - first byte arrived but the response never completed ⇒ `initialize-timeout`.
 *
 * `promise` never resolves; it only exists to lose the race. `cancel()` must be called
 * once the handshake settles, otherwise a deadline would later log a phantom failure.
 */
function createInitializeDeadlines(args: {
  probe: StdoutProbe;
  initializeTimeoutMs: number;
  firstByteTimeoutMs: number;
  logger: Logger;
  diagnostics: () => Record<string, unknown>;
  exitCode: () => number | null;
}): { promise: Promise<never>; cancel: () => void } {
  const { probe, initializeTimeoutMs, firstByteTimeoutMs, logger, diagnostics, exitCode } = args;

  let settled = false;
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  let initTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    settled = true;
    if (firstByteTimer) clearTimeout(firstByteTimer);
    if (initTimer) clearTimeout(initTimer);
  };
  const settle = (reject: (error: Error) => void, error: Error): void => {
    if (settled) return;
    cancel();
    reject(error);
  };

  const promise = new Promise<never>((_resolve, reject) => {
    firstByteTimer = setTimeout(() => {
      // An unsupported probe must not fail the spawn — we cannot prove silence there.
      if (!probe.supported || probe.firstByteAt !== null) return;
      const detail = diagnostics();
      logger.error('createAcpAgentConnection: spawn-stdio-dead', {
        reason: 'no stdout byte before first-byte deadline',
        ...detail,
      });
      settle(
        reject,
        new Error(
          `${STDIO_DEAD_PREFIX}: no stdout byte from agent within ${firstByteTimeoutMs}ms ` +
            `(stdoutBytes=${String(detail.stdoutBytes)}, spawnPid=${String(detail.spawnPid)}, ` +
            `exitCode=${String(exitCode() ?? 'null')})`
        )
      );
    }, firstByteTimeoutMs);

    initTimer = setTimeout(() => {
      const detail = diagnostics();
      logger.error('createAcpAgentConnection: initialize timed out', {
        reason: 'initialize handshake did not complete',
        ...detail,
      });
      settle(
        reject,
        new Error(
          `${INIT_TIMEOUT_PREFIX}: ACP initialize did not complete within ${initializeTimeoutMs}ms ` +
            `(stdoutBytes=${String(detail.stdoutBytes)}, ` +
            `stdoutFirstByteAtMs=${String(detail.stdoutFirstByteAtMs)}, ` +
            `spawnPid=${String(detail.spawnPid)}, exitCode=${String(exitCode() ?? 'null')})`
        )
      );
    }, initializeTimeoutMs);
  });

  return { promise, cancel };
}

function readTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Keep only the last `limit` characters of the agent's stderr for failure payloads. */
function createStderrTail(): { push(text: string): void; tail(limit: number): string } {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      if (buffer.length > STDERR_BUFFER_CHARS) {
        buffer = buffer.slice(buffer.length - STDERR_BUFFER_CHARS);
      }
    },
    tail(limit) {
      const trimmed = buffer.trimEnd();
      return trimmed.length > limit ? trimmed.slice(trimmed.length - limit) : trimmed;
    },
  };
}

const SECRET_ARG_PATTERN =
  /(?:^|[-_ ])(?:token|secret|password|passwd|api[-_]?key|key)(?:[-_=:]|$)/i;

/** Command lines can carry credentials; keep diagnostics useful without leaking them. */
function redactDiagnosticText(value: string): string {
  if (SECRET_ARG_PATTERN.test(value)) return '<redacted>';
  return value.length > MAX_LOGGED_ARG_CHARS ? `${value.slice(0, MAX_LOGGED_ARG_CHARS)}…` : value;
}
