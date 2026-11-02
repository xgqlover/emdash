import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { client } from '../rpc/client';
import type { CallOptions, Connection } from './connect';
import { defineContract, liveModel, liveState, procedure } from './define';

// [XG-CUSTOM 2026-11-02] Proves the plumbing of `holdWhileDisconnected`:
// a procedure definition default reaches `connection.call`, a per-call option
// still wins, and live state-replica snapshots keep holding by default while
// the resync refetch opts out.
describe('holdWhileDisconnected plumbing', () => {
  it('applies a procedure default to the wire call and lets the caller override it', async () => {
    const calls: Array<{ path: string; options: CallOptions | undefined }> = [];
    const contract = defineContract({
      metricsPoll: procedure({
        input: z.void().optional(),
        output: z.unknown(),
        holdWhileDisconnected: false,
      }),
      writeThing: procedure({ input: z.void().optional(), output: z.unknown() }),
    });
    const contractClient = client(contract, recordingConnection(calls));

    await contractClient.metricsPoll();
    await contractClient.writeThing();
    await contractClient.metricsPoll(undefined, { holdWhileDisconnected: true });

    expect(calls.map((call) => call.path)).toEqual(['metricsPoll', 'writeThing', 'metricsPoll']);
    expect(calls[0]?.options?.holdWhileDisconnected).toBe(false);
    // Writes must keep queueing: no default, no option.
    expect(calls[1]?.options?.holdWhileDisconnected).toBeUndefined();
    // An explicit per-call option always wins over the definition default.
    expect(calls[2]?.options?.holdWhileDisconnected).toBe(true);
  });

  it('defaults a live state-replica snapshot to holding and passes the opt-out through', async () => {
    const snapshots: Array<{ topic: string; options: CallOptions | undefined }> = [];
    const contract = defineContract({
      replica: liveModel({
        key: z.string(),
        states: { current: liveState({ data: z.unknown() }) },
      }),
    });
    const contractClient = client(contract, recordingConnection([], snapshots));
    const handle = contractClient.replica.state('key-1', 'current');

    // Initial seed: held (a model attached while disconnected seeds on reconnect).
    await handle.snapshot();
    // Resync refetch: explicitly non-queueing.
    await handle.snapshot({ holdWhileDisconnected: false });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.options?.holdWhileDisconnected).toBeUndefined();
    expect(snapshots[1]?.options?.holdWhileDisconnected).toBe(false);
    expect(snapshots[0]?.topic).toContain('key-1');
  });

  it('does not queue a metrics poll twice when the transport is down', async () => {
    // The panel polls every 5 s. With the opt-out the call must be absent from
    // the held buffer entirely: it never reaches `connection.call` as held work.
    const calls: Array<{ path: string; options: CallOptions | undefined }> = [];
    const contract = defineContract({
      getMachineMetrics: procedure({
        input: z.void().optional(),
        output: z.unknown(),
        holdWhileDisconnected: false,
      }),
    });
    const contractClient = client(contract, recordingConnection(calls));

    await contractClient.getMachineMetrics();
    await contractClient.getMachineMetrics();

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.options?.holdWhileDisconnected === false)).toBe(true);
  });
});

function recordingConnection(
  calls: Array<{ path: string; options: CallOptions | undefined }>,
  snapshots: Array<{ topic: string; options: CallOptions | undefined }> = []
): Connection {
  const connection = {
    call: async (path: string, _input: unknown, options?: CallOptions) => {
      calls.push({ path, options });
      return { ok: true };
    },
    snapshot: async (topic: string, options?: CallOptions) => {
      snapshots.push({ topic, options });
      return { data: {}, generation: 0, sequence: 0 };
    },
    attach: async () => () => {},
    onDisconnect: () => () => {},
    openBlobConsumer: () => {
      throw new Error('unused');
    },
    openBlobProducer: () => {
      throw new Error('unused');
    },
    dispose: () => {},
  };
  return connection as unknown as Connection;
}
