import { createEmitter, type Unsubscribe } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { Scope } from '@emdash/shared/concurrency';
import { createManualClock, createStubLogger } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract, procedure } from '../api/define';
import { WORKER_READY_SIGNAL } from './protocol';
import type {
  ProcessExit,
  WorkerProcess,
  WorkerProcessSpawner,
  WorkerProcessSpec,
  WorkerStdioStream,
} from './types';
import { WorkerSlot } from './worker-slot';

// [XG-CUSTOM 2026-11-02] P0 回归：一个 worker 死掉**不许**拖死宿主进程。
// 真机病根（ops 2026-11-02）：worker 死后主进程往它 IPC `send()` 抛 EPIPE，
// `send()` 没有 try/catch、也没有 `child.on('error')` ⇒ `Unhandled 'error' event`
// ⇒ 整个 workspace-server 退出，客户端看到 Wire transport disconnected。
// 这里钉住三件事：① 失败被结构化记录一次并**当作 worker 已死**；
// ② 宿主照常活着、还能重启该 worker；③ 重启是**有界**的（5 次后标 failed）。
const api = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
});

const WRITE_EPIPE = 'write EPIPE';

function epipe(): Error {
  return Object.assign(new Error(WRITE_EPIPE), { code: 'EPIPE' });
}

class FakeIpcProcess implements WorkerProcess {
  readonly pid = 4_242;
  readonly received: unknown[] = [];
  dead = false;
  private exited = false;
  private readonly messageEmitter = createEmitter<unknown>();
  private readonly exitEmitter = createEmitter<ProcessExit>();
  private readonly errorEmitter = createEmitter<unknown>();
  private readonly stdioEmitter = createEmitter<{ stream: WorkerStdioStream; chunk: string }>();

  constructor(readonly spec: WorkerProcessSpec) {}

  send(message: unknown): void {
    if (this.dead) {
      // What the fixed spawner does: never throw, always route to onError.
      this.errorEmitter.emit(epipe());
      return;
    }
    this.received.push(message);
  }

  onError(cb: (error: unknown) => void): Unsubscribe {
    return this.errorEmitter.subscribe(cb);
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    return this.messageEmitter.subscribe(cb);
  }

  onExit(cb: (exit: ProcessExit) => void): Unsubscribe {
    return this.exitEmitter.subscribe(cb);
  }

  onStdio(cb: (stream: WorkerStdioStream, chunk: string) => void): Unsubscribe {
    return this.stdioEmitter.subscribe(({ stream, chunk }) => cb(stream, chunk));
  }

  kill(): void {
    this.emitExit({ code: null, signal: 'SIGKILL' });
  }

  signalReady(): void {
    this.messageEmitter.emit(WORKER_READY_SIGNAL);
  }

  /** The worker's IPC channel dies without the process reporting an exit. */
  dropIpc(): void {
    this.dead = true;
    this.errorEmitter.emit(epipe());
  }

  emitExit(exit: ProcessExit): void {
    if (this.exited) return;
    this.exited = true;
    this.exitEmitter.emit(exit);
  }
}

class FakeIpcSpawner implements WorkerProcessSpawner {
  readonly processes: FakeIpcProcess[] = [];

  async spawn(spec: WorkerProcessSpec, _scope: Scope): Promise<WorkerProcess> {
    const process = new FakeIpcProcess(spec);
    this.processes.push(process);
    return process;
  }

  latest(): FakeIpcProcess {
    const process = this.processes.at(-1);
    if (!process) throw new Error('no process was spawned');
    return process;
  }
}

function createSlot(options: { spawner: WorkerProcessSpawner; scope: Scope; clock: ReturnType<typeof createManualClock>; logger: ReturnType<typeof createStubLogger>['logger']; name?: string }) {
  return new WorkerSlot({
    definition: {
      name: options.name ?? 'resource-usage-runtime',
      contract: api,
      process: () => ({ entry: 'resource-usage-runtime.mjs' }),
      readyTimeoutMs: 1_000,
      shutdownGraceMs: 0,
    },
    scope: options.scope,
    processSpawner: options.spawner,
    clock: options.clock,
    logger: options.logger,
  });
}

async function flush(): Promise<void> {
  // Microtasks settle the IPC/log paths; one macrotask lets the async spawner
  // (and the supervision loop's continuation after `clock.sleep`) run.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}


/** Advances the manual clock in small steps until the next process is spawned. */
async function waitForSpawn(
  spawner: FakeIpcSpawner,
  count: number,
  clock: ReturnType<typeof createManualClock>
): Promise<void> {
  for (let step = 0; step < 30 && spawner.processes.length < count; step += 1) {
    await clock.advanceBy(100);
    await flush();
  }
  if (spawner.processes.length < count) {
    throw new Error(`expected ${count} spawned workers, saw ${spawner.processes.length}`);
  }
}

describe('worker IPC failure containment', () => {
  it('logs one structured warn, keeps the host alive and restarts the worker', async () => {
    const clock = createManualClock();
    const spawner = new FakeIpcSpawner();
    const scope = createScope({ label: 'p0' });
    const { logger, calls } = createStubLogger();
    const slot = createSlot({ spawner, scope, clock, logger });

    const ready = slot.ready();
    await flush();
    const first = spawner.latest();
    first.signalReady();
    const client = await ready;

    // The in-flight call loses its peer: it must fail fast, not hang forever.
    const inFlight = client.ping('one').catch((error: unknown) => error);
    await flush();
    first.dropIpc();
    const failure = await inFlight;
    expect(failure).toMatchObject({ code: 'DISCONNECTED' });

    // Exactly one structured line, carrying worker / code / payloadKind.
    const warns = calls.filter((call) => call.message.includes('treating worker as dead'));
    expect(warns).toHaveLength(1);
    expect(warns[0]?.level).toBe('warn');
    expect(warns[0]?.fields).toMatchObject({
      worker: 'resource-usage-runtime',
      code: 'EPIPE',
      payloadKind: 'call',
    });

    // The host is still usable: supervision restarts the worker on the ladder.
    const queued = client.ping('two').catch((error: unknown) => error);
    await waitForSpawn(spawner, 2, clock);
    const second = spawner.latest();
    expect(second).not.toBe(first);
    second.signalReady();
    await flush();

    // A call issued while the worker was down is delivered after the restart.
    const delivered = second.received.find(
      (message) =>
        (message as { payload?: { path?: string } }).payload?.path === 'ping'
    ) as { payload?: { input?: unknown } } | undefined;
    expect(delivered?.payload?.input).toBe('two');
    void queued;

    await slot.dispose();
    await scope.dispose();
  });

  it('stops restarting after five bounded attempts instead of hot-looping', async () => {
    const clock = createManualClock();
    const spawner = new FakeIpcSpawner();
    const scope = createScope({ label: 'p0-bounded' });
    const { logger } = createStubLogger();
    const slot = createSlot({ spawner, scope, clock, logger, name: 'files-runtime' });

    const ready = slot.ready().catch(() => undefined);
    await flush();

    // Every generation dies the moment it reports ready. Walk the exact ladder:
    // 1 s / 2 s / 5 s / 10 s / 10 s of supervision delay per restart.
    for (const delay of [1_000, 2_000, 5_000, 10_000, 10_000]) {
      const process = spawner.latest();
      process.signalReady();
      await flush();
      process.emitExit({ code: 1 });
      await flush();
      await clock.advanceBy(delay);
      await flush();
    }
    // Sixth generation: it dies too and the ladder is exhausted.
    const last = spawner.latest();
    last.signalReady();
    await flush();
    last.emitExit({ code: 1 });
    await flush();

    await ready;
    expect(slot.state.kind).toBe('failed');
    expect(slot.state).toMatchObject({ kind: 'failed', attempts: 6 });
    // 1 first start + 5 bounded restarts, then supervision gives up.
    expect(spawner.processes).toHaveLength(6);

    await slot.dispose();
    await scope.dispose();
  });
});
