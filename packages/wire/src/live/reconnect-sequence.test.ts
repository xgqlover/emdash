import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LiveSnapshot, LiveUpdate } from '../api/channel';
import type { LiveClientHandle } from '../api/client';
import type { WireResyncEvent } from '../api/instrumentation';
import { resyncMarkStale } from './follower';
import { ReplicaState } from './replica/state';
import { LiveStateClient } from './state';

// [XG-CUSTOM 2026-11-02] 「重启/断线后客户端要手动 Retry」的 wire 侧根因回归。
//
// 服务端每份 live 资源都是一个新建的 LiveStateSource（generation = Date.now()，
// sequence 从 0 起），所以序号**不会**跨进程沿用；真正把副本打成 sequence-gap 的
// 是客户端：重连后服务端会把「种子已经覆盖过」的 delta 再推一次，而旧代码把
// `baseSequence !== sequence` 一律判成 gap ⇒ 每推一次就再来一轮 resync。
// 客户端日志实证（Windows emdash.log）：同一毫秒里三个副本分别 expected 14 / 1 / 14，
// got 15 / 16 —— 同一条 update 打到三个不同游标上，落后的那个永远追不上。
const stateSchema = z.object({ count: z.number() });
type State = z.infer<typeof stateSchema>;

function snapshotOf(count: number, generation: number, sequence: number): LiveSnapshot<State> {
  return { generation, sequence, timestamp: 0, data: { count } };
}

function updateOf(generation: number, baseSequence: number, count: number): LiveUpdate {
  return {
    generation,
    baseSequence,
    sequence: baseSequence + 1,
    timestamp: 0,
    delta: [{ op: 'replace', path: ['count'], value: count }],
  };
}

describe('reconnect stream numbering', () => {
  it('ignores a delta the seed already covers instead of resyncing', async () => {
    const clock = createManualClock();
    const resyncs: WireResyncEvent[] = [];
    const client = new LiveStateClient<State>(
      stateSchema,
      async () => snapshotOf(42, 5, 21),
      () => {},
      {
        clock,
        onResyncFailed: resyncMarkStale(),
        instrumentation: { resync: (event) => resyncs.push(event) },
      }
    );
    client.seed(snapshotOf(10, 5, 10));

    // A replayed delta from before the seed: already covered, must be a no-op.
    client.applyUpdate(updateOf(5, 5, 6));
    await clock.advanceBy(0);
    expect(resyncs).toHaveLength(0);
    expect(client.getSnapshot()).toEqual({ count: 10 });

    // The contiguous next delta still applies.
    client.applyUpdate(updateOf(5, 10, 11));
    await clock.advanceBy(0);
    expect(client.getSnapshot()).toEqual({ count: 11 });
    expect(resyncs).toHaveLength(0);

    // A genuinely forward jump is still a gap and still resyncs.
    client.applyUpdate(updateOf(5, 20, 21));
    await clock.advanceBy(0);
    expect(resyncs).toHaveLength(1);
    expect(resyncs[0]).toMatchObject({ reason: 'sequence-gap', details: { expected: 11, got: 20 } });
    expect(client.getSnapshot()).toEqual({ count: 42 });
  });

  it('ignores a delta that arrives before the initial seed', async () => {
    const clock = createManualClock();
    const resyncs: WireResyncEvent[] = [];
    const client = new LiveStateClient<State>(
      stateSchema,
      async () => snapshotOf(3, 9, 4),
      () => {},
      {
        clock,
        onResyncFailed: resyncMarkStale(),
        instrumentation: { resync: (event) => resyncs.push(event) },
      }
    );

    client.applyUpdate(updateOf(9, 0, 1));
    await clock.advanceBy(0);
    expect(resyncs).toHaveLength(0);
    expect(client.isReady()).toBe(false);
  });

  it('restarts the local stream at sequence 1 after a disconnect/reconnect reseed', async () => {
    const clock = createManualClock();
    const fake = createFakeHandle();
    const replica = new ReplicaState<State>(fake.handle, {
      clock,
      onResyncFailed: resyncMarkStale(),
    });
    const emitted: LiveUpdate[] = [];
    replica.subscribe((update) => emitted.push(update));
    await replica.ready;

    // Seeded from upstream (generation 7, sequence 1); nothing applied yet.
    expect(emitted).toHaveLength(0);
    expect(replica.current()).toEqual({ count: 1 });

    // While the client is disconnected the server moves from sequence 1 to 20.
    fake.setSnapshotSequence(20);
    fake.reattach();
    await clock.advanceBy(0);
    expect(replica.stale).toBe(false);
    expect(replica.current()).toEqual({ count: 20 });

    // On reconnect the server replays a delta the fresh seed already covers.
    fake.push(updateOf(7, 1, 2));
    await clock.advanceBy(0);
    expect(emitted).toHaveLength(0);
    expect(replica.stale).toBe(false);
    expect(replica.current()).toEqual({ count: 20 });

    // The first update of the new stream is renumbered from 1 locally.
    fake.push(updateOf(7, 20, 21));
    await clock.advanceBy(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ baseSequence: 0, sequence: 1 });
    expect(replica.current()).toEqual({ count: 21 });
    expect(replica.stale).toBe(false);

    // And the next one continues 2, 3 — never a restart per update.
    fake.push(updateOf(7, 21, 22));
    await clock.advanceBy(0);
    expect(emitted.map((update) => update.sequence)).toEqual([1, 2]);
    expect(replica.current()).toEqual({ count: 22 });

    await replica.dispose();
  });
});

function createFakeHandle(): {
  handle: LiveClientHandle<State>;
  push(update: LiveUpdate): void;
  reattach(): void;
  setSnapshotSequence(sequence: number): void;
} {
  let push: ((update: LiveUpdate) => void) | undefined;
  let reattach: (() => void) | undefined;
  let snapshotSequence = 1;
  const handle = {
    topic: 'replica.test',
    async snapshot(): Promise<LiveSnapshot<State>> {
      return snapshotOf(snapshotSequence, 7, snapshotSequence);
    },
    async attach(update: (value: LiveUpdate) => void, options?: { onReattach?: () => void }) {
      push = update;
      reattach = options?.onReattach;
      return () => {};
    },
    asLiveSource() {
      throw new Error('unused');
    },
  };
  return {
    handle: handle as unknown as LiveClientHandle<State>,
    push(update) {
      push?.(update);
    },
    reattach() {
      reattach?.();
    },
    setSnapshotSequence(sequence) {
      snapshotSequence = sequence;
    },
  };
}
