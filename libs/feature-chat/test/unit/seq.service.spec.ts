import { SeqService, type SeqFloor } from '../../src/chat/seq.service';

/**
 * Fake Valkey modelling only what SeqService uses: EXISTS, INCR, SET NX. `flush()` simulates the
 * failure this service exists to survive — a restart, an eviction, or a FLUSHALL wiping `seq:*`.
 */
function fakeRedis() {
  let counters = new Map<string, number>();
  return {
    async exists(key: string) {
      return counters.has(key) ? 1 : 0;
    },
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async set(key: string, value: string, mode?: string) {
      if (mode === 'NX' && counters.has(key)) return null;
      counters.set(key, Number(value));
      return 'OK';
    },
    /** test-only: wipe the keyspace, as a Valkey restart without AOF would. */
    flush() {
      counters = new Map<string, number>();
    },
  };
}

/** Durable floor backed by a plain map, standing in for `MAX(seq)` in Mongo. */
function fakeFloor(
  seed: Record<string, number> = {},
): SeqFloor & { set(c: string, n: number): void } {
  const max = new Map<string, number>(Object.entries(seed));
  return {
    async maxSeq(conversationId: string) {
      // A real Mongo round trip yields; without this the "concurrent cold start" test below
      // could never interleave and would prove nothing.
      await Promise.resolve();
      return max.get(conversationId) ?? 0;
    },
    set(conversationId: string, n: number) {
      max.set(conversationId, n);
    },
  };
}

describe('SeqService (§B4.3 per-conversation order)', () => {
  it('returns a monotonic seq per conversation', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeFloor());
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
  });

  it('tracks conversations independently', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeFloor());
    expect(await seq.next('conv-a')).toBe(1);
    expect(await seq.next('conv-b')).toBe(1);
    expect(await seq.next('conv-a')).toBe(2);
  });

  it('seeds from the durable floor when the counter key is missing (DEF-01)', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeFloor({ 'conv-1': 5 }));
    expect(await seq.next('conv-1')).toBe(6);
  });

  it('never reissues a seq after the counter is lost (DEF-01)', async () => {
    const redis = fakeRedis();
    const floor = fakeFloor();
    const seq = new SeqService(redis as never, floor);

    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
    floor.set('conv-1', 3); // those three are now persisted in Mongo

    redis.flush(); // Valkey restarts / evicts / is flushed

    // Reissuing 1 here is silent message loss: the mobile client's reconcileDecision matches on
    // (conversation_id, seq) and would SKIP the new message as one it already holds.
    expect(await seq.next('conv-1')).toBe(4);
  });

  it('gives concurrent cold-start callers distinct seqs above the floor (DEF-01)', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeFloor({ 'conv-1': 5 }));

    const results = await Promise.all(Array.from({ length: 10 }, () => seq.next('conv-1')));

    expect(new Set(results).size).toBe(10);
    expect(Math.min(...results)).toBeGreaterThan(5);
  });

  it('does not re-read the durable floor once the counter is warm', async () => {
    const floor = fakeFloor({ 'conv-1': 5 });
    const spy = jest.spyOn(floor, 'maxSeq');
    const seq = new SeqService(fakeRedis() as never, floor);

    await seq.next('conv-1');
    await seq.next('conv-1');
    await seq.next('conv-1');

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
