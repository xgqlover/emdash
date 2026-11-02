import { createEmitter, type Unsubscribe } from '@emdash/shared';
import { isWireMessage, WireError, type WireMessage, type WireTransport } from '../api/protocol';
import { isWireWorkerFrame, RUNTIME_CHANNEL } from './component-protocol';
import { isWorkerSignal } from './protocol';
import type { ProcessExit, WorkerProcess } from './types';

type ActiveGeneration = {
  generation: number;
  process: WorkerProcess;
  ready: boolean;
  readySignaled: boolean;
  /** [XG-CUSTOM 2026-11-02] Subscription to the process' own error channel. */
  unsubscribeError?: Unsubscribe;
};

export class WorkerLink implements WireTransport {
  private active: ActiveGeneration | undefined;
  private closed = false;
  private readonly messageEmitter = createEmitter<WireMessage>();
  private readonly disconnectEmitter = createEmitter<void>();
  private readonly reconnectEmitter = createEmitter<void>();
  private readonly terminalFailureEmitter = createEmitter<unknown>();
  private readonly readyEmitter = createEmitter<number>();
  private readonly postFailureEmitter = createEmitter<{
    generation: number;
    payloadKind: string;
    error: unknown;
  }>();
  /**
   * [XG-CUSTOM 2026-11-02] Last payload kind handed to `send()`. A dead IPC
   * channel reports asynchronously (`onError`), so this is what lets the single
   * diagnostic line name the payload kind instead of leaving it blank.
   */
  private lastPayloadKind: string | undefined;

  post(message: WireMessage): void {
    const active = this.active;
    if (this.closed || !active?.ready) {
      throw new WireError('DISCONNECTED', 'Wire worker is not ready');
    }
    this.lastPayloadKind = message.kind;
    try {
      active.process.send({
        kind: 'wire-worker-frame',
        channel: RUNTIME_CHANNEL,
        payload: message,
      });
    } catch (error) {
      // [XG-CUSTOM 2026-11-02] Report the generation + payload kind so the slot
      // can log one structured line ("worker X send failed (EPIPE) for call")
      // and then treat the worker as dead. Never let a raw IPC error escape.
      this.reportPostFailure(active.generation, message.kind, error);
      throw new WireError('DISCONNECTED', 'Wire worker process is unavailable', {
        cause: error,
        delivery: 'not-sent',
      });
    }
  }

  /** [XG-CUSTOM 2026-11-02] Send failures, already normalised to a WireError for callers. */
  onPostFailure(
    cb: (event: { generation: number; payloadKind: string; error: unknown }) => void
  ): Unsubscribe {
    return this.postFailureEmitter.subscribe(cb);
  }

  onMessage(cb: (message: WireMessage) => void): Unsubscribe {
    return this.messageEmitter.subscribe(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    return this.disconnectEmitter.subscribe(cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    return this.reconnectEmitter.subscribe(cb);
  }

  onTerminalFailure(cb: (error: unknown) => void): Unsubscribe {
    if (this.closed) cb(new Error('Wire worker link closed'));
    return this.terminalFailureEmitter.subscribe(cb);
  }

  onReady(cb: (generation: number) => void): Unsubscribe {
    return this.readyEmitter.subscribe(cb);
  }

  hasReadySignal(generation: number): boolean {
    return this.active?.generation === generation && this.active.readySignaled;
  }

  attach(generation: number, process: WorkerProcess): void {
    if (this.closed) return;
    this.active = {
      generation,
      process,
      ready: false,
      readySignaled: false,
      unsubscribeError: process.onError?.((error) =>
        this.reportPostFailure(generation, this.lastPayloadKind, error)
      ),
    };
  }

  /** [XG-CUSTOM 2026-11-02] One place turns any send/process failure into a report. */
  private reportPostFailure(generation: number, payloadKind: string | undefined, error: unknown): void {
    if (this.closed) return;
    this.postFailureEmitter.emit({ generation, payloadKind: payloadKind ?? 'unknown', error });
  }

  handleMessage(generation: number, message: unknown): void {
    const active = this.active;
    if (!active || active.generation !== generation || this.closed) return;
    if (isWorkerSignal(message, 'ready')) {
      active.readySignaled = true;
      this.readyEmitter.emit(generation);
      return;
    }
    if (isWireWorkerFrame(message)) {
      if (message.channel === RUNTIME_CHANNEL && isWireMessage(message.payload)) {
        this.messageEmitter.emit(message.payload);
      }
      return;
    }
  }

  markReady(generation: number): void {
    const active = this.active;
    if (!active || active.generation !== generation || this.closed) return;
    active.ready = true;
    // Every readiness — first start and restarts alike — reports connectivity,
    // so the connection can flush calls held while the worker was down.
    this.reconnectEmitter.emit();
  }

  detach(generation: number, _exit?: ProcessExit): void {
    const active = this.active;
    if (!active || active.generation !== generation) return;
    active.unsubscribeError?.();
    this.active = undefined;
    if (!this.closed) this.disconnectEmitter.emit();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.active?.unsubscribeError?.();
    this.active = undefined;
    this.disconnectEmitter.emit();
    this.terminalFailureEmitter.emit(new Error('Wire worker link closed'));
    this.messageEmitter.clear();
    this.disconnectEmitter.clear();
    this.reconnectEmitter.clear();
    this.terminalFailureEmitter.clear();
    this.readyEmitter.clear();
    this.postFailureEmitter.clear();
  }
}
