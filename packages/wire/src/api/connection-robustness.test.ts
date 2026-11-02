import type { Unsubscribe } from '@emdash/shared';
import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { FakeWorkerProcess } from '../testing/fake-worker-process';
import { WorkerLink } from '../worker/link';
import { connect } from './connect';
import type { WireHeldCallEvictedEvent } from './instrumentation';
import { WireError, type WireMessage, type WireTransport } from './protocol';

describe('connection call deadline', () => {
  it.each(['timeout', 'cancel', 'dispose', 'terminal'] as const)(
    'distinguishes held requests from posted requests on %s',
    async (outcome) => {
      for (const held of [false, true]) {
        const clock = createManualClock();
        const transport = scriptedTransport({ reconnectCapable: true });
        const connection = connect(transport, { clock });
        const abort = new AbortController();
        if (held) transport.goDown();
        const result = connection
          .call('prompt', {}, { signal: abort.signal })
          .catch((error: unknown) => error);
        if (outcome === 'timeout') await clock.advanceBy(30_000);
        if (outcome === 'cancel') abort.abort();
        if (outcome === 'dispose') connection.dispose();
        if (outcome === 'terminal') transport.failTerminally(new Error('failed'));
        const error = await result;
        expect(error).toBeInstanceOf(WireError);
        expect((error as WireError).delivery).toBe(held ? 'not-sent' : undefined);
        if (held) {
          transport.goUp();
          expect(transport.sent).toHaveLength(0);
        }
        connection.dispose();
      }
    }
  );

  it('rejects a call with a TIMEOUT WireError when the peer never answers', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    const call = connection.call('slow.procedure', { id: 1 });
    const rejection = expectWireError(call, 'TIMEOUT');
    await clock.advanceBy(30_000);

    await rejection;
    expect(transport.sent.filter((message) => message.kind === 'cancel')).toHaveLength(1);
    connection.dispose();
  });

  it('honors a per-call timeout override', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    const call = connection.call('slow.procedure', {}, { timeoutMs: 5_000 });
    const rejection = expectWireError(call, 'TIMEOUT');
    await clock.advanceBy(5_000);

    await rejection;
    connection.dispose();
  });

  it('disables the deadline for a per-call timeout of zero', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    const call = connection.call('slow.procedure', {}, { timeoutMs: 0 });
    await clock.advanceBy(120_000);
    transport.replyToLatestCall('late but fine');

    await expect(call).resolves.toBe('late but fine');
    connection.dispose();
  });

  it('applies the deadline to snapshot requests', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    const snapshot = connection.snapshot('topic');
    const rejection = expectWireError(snapshot, 'TIMEOUT');
    await clock.advanceBy(30_000);

    await rejection;
    connection.dispose();
  });

  it('rejects a timed-out call over a plain transport too', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: false });
    const connection = connect(transport, { clock });

    const call = connection.call('slow.procedure', {});
    const rejection = expectWireError(call, 'TIMEOUT');
    await clock.advanceBy(30_000);

    await rejection;
    connection.dispose();
  });
});

describe('hold-until-deadline while disconnected', () => {
  it('holds a call issued while disconnected and completes it after reconnect', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const call = connection.call('during.restart', { id: 7 });
    await clock.advanceBy(10_000);
    expect(transport.sent).toHaveLength(0);

    transport.goUp();
    expect(transport.sent).toHaveLength(1);
    transport.replyToLatestCall('made it');

    await expect(call).resolves.toBe('made it');
    connection.dispose();
  });

  it('lets the deadline span time spent held while disconnected', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const call = connection.call('held.forever', {});
    const rejection = expectWireError(call, 'TIMEOUT');
    await clock.advanceBy(30_000);
    await rejection;

    transport.goUp();
    expect(transport.sent).toHaveLength(0);
    connection.dispose();
  });

  // [XG-CUSTOM 2026-11-02] The overflow policy changed: a full buffer now drops
  // the OLDEST held call (FIFO) so the newest request always gets a slot. The
  // old policy rejected the newest call and left stale ones parked in the
  // buffer — 1 000 dead calls per disconnect in the field.
  it('evicts the oldest held call on overflow, never the newly issued one', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock, maxHeldCalls: 2 });

    transport.goDown();
    const first = connection.call('held.first', {});
    const second = connection.call('held.second', {});
    const third = connection.call('held.third', {});

    const evicted = await expectWireError(first, 'DISCONNECTED');
    expect(evicted.message).toBe('Wire held-call buffer is full while disconnected');
    expect(evicted.delivery).toBe('not-sent');

    transport.goUp();
    expect(transport.sent.map(callPath)).toEqual(['held.second', 'held.third']);
    transport.replyToCall('held.second', 'two');
    transport.replyToCall('held.third', 'three');
    await expect(second).resolves.toBe('two');
    await expect(third).resolves.toBe('three');
    connection.dispose();
  });

  it('counts every evicted held call through heldCallEvicted instrumentation', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const events: WireHeldCallEvictedEvent[] = [];
    const connection = connect(transport, {
      clock,
      maxHeldCalls: 1,
      instrumentation: { heldCallEvicted: (event) => events.push(event) },
    });

    transport.goDown();
    const calls = ['held.a', 'held.b', 'held.c'].map((path) => connection.call(path, {}));

    await expectWireError(calls[0]!, 'DISCONNECTED');
    await expectWireError(calls[1]!, 'DISCONNECTED');
    expect(events.map((event) => event.path)).toEqual(['held.a', 'held.b']);
    expect(events.map((event) => event.evictedTotal)).toEqual([1, 2]);
    expect(events.map((event) => event.buffered)).toEqual([0, 0]);
    expect(events.map((event) => event.maxHeldCalls)).toEqual([1, 1]);

    transport.goUp();
    expect(transport.sent.map(callPath)).toEqual(['held.c']);
    transport.replyToCall('held.c', 'ok');
    await expect(calls[2]!).resolves.toBe('ok');
    connection.dispose();
  });

  it('never lets the held buffer grow past maxHeldCalls under sustained pressure', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const events: WireHeldCallEvictedEvent[] = [];
    const connection = connect(transport, {
      clock,
      maxHeldCalls: 3,
      instrumentation: { heldCallEvicted: (event) => events.push(event) },
    });

    transport.goDown();
    const calls = Array.from({ length: 20 }, (_, index) =>
      connection.call(`pressure.${index}`, {}).catch((error: unknown) => error)
    );

    // Eviction fires only when the buffer is already full, and the post-eviction
    // size is always one below the bound (the new call then fills that slot).
    expect(events.length).toBe(17);
    expect(events.every((event) => event.buffered <= 2)).toBe(true);
    expect(events.every((event) => event.maxHeldCalls === 3)).toBe(true);
    expect(events.at(-1)?.evictedTotal).toBe(17);

    transport.goUp();
    // Only the three newest survive; everything older is a not-sent rejection.
    expect(transport.sent.map(callPath)).toEqual(['pressure.17', 'pressure.18', 'pressure.19']);
    for (const path of ['pressure.17', 'pressure.18', 'pressure.19']) {
      transport.replyToCall(path, path);
    }
    const settled = await Promise.all(calls);
    expect(settled.slice(0, 17).every((value) => value instanceof WireError)).toBe(true);
    expect(settled.slice(17)).toEqual(['pressure.17', 'pressure.18', 'pressure.19']);
    connection.dispose();
  });

  it('keeps maxHeldCalls: 0 failing fast because there is nothing to evict', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock, maxHeldCalls: 0 });

    transport.goDown();
    const evicted = await expectWireError(connection.call('never.held', {}), 'DISCONNECTED');
    expect(evicted.delivery).toBe('not-sent');

    transport.goUp();
    expect(transport.sent).toHaveLength(0);
    connection.dispose();
  });

  it('fails a holdWhileDisconnected:false read fast and still holds the rest', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const read = connection.call('metrics.poll', {}, { holdWhileDisconnected: false });
    const rejected = await expectWireError(read, 'DISCONNECTED');
    expect(rejected.delivery).toBe('not-sent');
    expect(rejected.message).toBe('Wire transport disconnected');

    const held = connection.call('must.not.drop', {});
    transport.goUp();
    expect(transport.sent.map(callPath)).toEqual(['must.not.drop']);
    transport.replyToCall('must.not.drop', 'ok');
    await expect(held).resolves.toBe('ok');
    connection.dispose();
  });

  it('applies the hold opt-out to snapshot reads too', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const snapshot = connection.snapshot('topic', { holdWhileDisconnected: false });
    const rejected = await expectWireError(snapshot, 'DISCONNECTED');
    expect(rejected.delivery).toBe('not-sent');

    transport.goUp();
    expect(transport.sent).toHaveLength(0);
    connection.dispose();
  });

  it('still holds a snapshot read that did not opt out', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const snapshot = connection.snapshot('topic');

    transport.goUp();
    expect(transport.sent).toHaveLength(1);
    const posted = transport.sent[0];
    expect(posted?.kind).toBe('snapshot');
    transport.replyOk(requestId(posted!));
    await expect(snapshot).resolves.toBeUndefined();
    connection.dispose();
  });

  it('rejects in-flight calls on disconnect but keeps held calls held', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    const inFlight = connection.call('posted.before', {});
    const inFlightRejection = expectWireError(inFlight, 'DISCONNECTED');
    transport.goDown();
    expect((await inFlightRejection).delivery).toBeUndefined();

    const held = connection.call('issued.after', {});
    transport.goUp();
    transport.replyToCall('issued.after', 'ok');
    await expect(held).resolves.toBe('ok');
    connection.dispose();
  });

  it('cancels a held call without posting a cancel frame', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });
    const abort = new AbortController();

    transport.goDown();
    const call = connection.call('held.cancelled', {}, { signal: abort.signal });
    abort.abort();

    await expectWireError(call, 'CANCELLED');
    transport.goUp();
    expect(transport.sent).toHaveLength(0);
    connection.dispose();
  });

  it('keeps a plain transport failing fast while disconnected', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: false });
    const connection = connect(transport, { clock });

    transport.goDown();
    expect(await expectWireError(connection.call('fails.fast', {}), 'DISCONNECTED')).toMatchObject({
      delivery: 'not-sent',
    });
    connection.dispose();
  });
});

describe('terminal failure and disposal', () => {
  it('rejects held and future calls with the terminal cause', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });
    const cause = new Error('gave up');

    transport.goDown();
    const held = connection.call('held.call', {});
    const heldRejection = expectWireError(held, 'DISCONNECTED');
    transport.failTerminally(cause);

    expect(await heldRejection).toMatchObject({ cause });

    const later = connection.call('after.terminal', {});
    expect(await expectWireError(later, 'DISCONNECTED')).toMatchObject({
      cause,
      delivery: 'not-sent',
    });
    connection.dispose();
  });

  it('rejects held calls when the connection is disposed', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const held = connection.call('held.call', {});
    const rejection = expectWireError(held, 'DISCONNECTED');
    connection.dispose();

    expect((await rejection).message).toBe('Wire connection disposed');
  });
});

describe('live attach exemption', () => {
  it('holds attach traffic without a deadline and never double-attaches', async () => {
    const clock = createManualClock();
    const transport = scriptedTransport({ reconnectCapable: true });
    const connection = connect(transport, { clock });

    transport.goDown();
    const attach = connection.attach('topic:1', () => {});
    await clock.advanceBy(120_000);
    expect(transport.sent).toHaveLength(0);

    transport.goUp();
    const attaches = transport.sent.filter((message) => message.kind === 'attach');
    expect(attaches).toHaveLength(1);
    transport.replyOk(requestId(attaches[0]));

    await expect(attach).resolves.toBeTypeOf('function');
    connection.dispose();
  });
});

describe('worker restarts through WorkerLink', () => {
  it('makes a restart that completes inside the deadline invisible to callers', async () => {
    const clock = createManualClock();
    const link = new WorkerLink();
    const connection = connect(link, { clock });
    const firstProcess = new FakeWorkerProcess({ entry: 'first' });
    const secondProcess = new FakeWorkerProcess({ entry: 'second' });

    link.attach(1, firstProcess);
    link.markReady(1);

    // The worker exits; the restart takes time and a call arrives meanwhile.
    link.detach(1);
    const call = connection.call('during.restart', { id: 1 });
    await clock.advanceBy(1_000);
    expect(secondProcess.parentMessages).toHaveLength(0);

    link.attach(2, secondProcess);
    link.markReady(2);
    const posted = latestFrame(secondProcess);
    expect(callPath(posted)).toBe('during.restart');
    link.handleMessage(2, {
      kind: 'wire-worker-frame',
      channel: 'runtime',
      payload: { kind: 'result', id: requestId(posted), ok: true, value: 'restarted' },
    });

    await expect(call).resolves.toBe('restarted');
    connection.dispose();
    link.close();
  });
});

type ScriptedTransport = WireTransport & {
  readonly sent: WireMessage[];
  goDown(): void;
  goUp(): void;
  failTerminally(error: unknown): void;
  replyOk(id: string): void;
  replyToCall(path: string, value: unknown): void;
  replyToLatestCall(value: unknown): void;
};

function scriptedTransport(options: { reconnectCapable: boolean }): ScriptedTransport {
  const sent: WireMessage[] = [];
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();
  const terminalListeners = new Set<(error: unknown) => void>();
  let up = true;

  const emit = (message: WireMessage): void => {
    for (const listener of messageListeners) listener(message);
  };

  const transport: ScriptedTransport = {
    sent,
    post(message) {
      if (!up) throw new WireError('DISCONNECTED', 'Scripted transport is down');
      sent.push(message);
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    goDown() {
      up = false;
      for (const listener of disconnectListeners) listener();
    },
    goUp() {
      up = true;
      for (const listener of reconnectListeners) listener();
    },
    failTerminally(error) {
      up = false;
      for (const listener of terminalListeners) listener(error);
    },
    replyOk(id) {
      emit({ kind: 'result', id, ok: true, value: undefined });
    },
    replyToCall(path, value) {
      const call = sent.find((message) => message.kind === 'call' && message.path === path);
      if (!call) throw new Error(`No call sent for ${path}`);
      emit({ kind: 'result', id: requestId(call), ok: true, value });
    },
    replyToLatestCall(value) {
      const call = [...sent].reverse().find((message) => message.kind === 'call');
      if (!call) throw new Error('No call sent');
      emit({ kind: 'result', id: requestId(call), ok: true, value });
    },
  };

  if (options.reconnectCapable) {
    transport.onReconnect = (cb) => {
      reconnectListeners.add(cb);
      return () => reconnectListeners.delete(cb);
    };
    transport.onTerminalFailure = (cb) => {
      terminalListeners.add(cb);
      return () => terminalListeners.delete(cb);
    };
  }

  return transport;
}

function latestFrame(process: FakeWorkerProcess): WireMessage {
  const frame = process.parentMessages.at(-1) as
    | { kind?: string; payload?: WireMessage }
    | undefined;
  if (frame?.kind !== 'wire-worker-frame' || !frame.payload) {
    throw new Error('No wire frame was sent to the worker process');
  }
  return frame.payload;
}

function requestId(message: WireMessage): string {
  if ('id' in message && typeof message.id === 'string') return message.id;
  throw new Error(`Message has no id: ${message.kind}`);
}

function callPath(message: WireMessage | undefined): string {
  if (message?.kind !== 'call') throw new Error('Expected a call message');
  return message.path;
}

async function expectWireError(
  promise: Promise<unknown>,
  code: WireError['code']
): Promise<WireError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WireError);
    expect((error as WireError).code).toBe(code);
    return error as WireError;
  }
  throw new Error(`Expected rejection with WireError ${code}`);
}
