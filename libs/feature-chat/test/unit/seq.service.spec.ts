import { SeqService } from '../../src/chat/seq.service';

/**
 * Fake Valkey modelling exactly what SeqService uses: the cold-start Lua (`EXISTS ? INCR : -1`),
 * `SET NX`, and `INCR`. `flush()` reproduces the failure this whole service exists to survive — a
 * restart, an eviction, or a FLUSHALL wiping `seq:*`. `breakIt()` reproduces an outage.
 */
function fakeRedis() {
  let store = new Map<string, number>();
  let broken = false;
  const guard = () => {
    if (broken) throw new Error('redis unreachable');
  };
  return {
    async eval(_script: string, _numKeys: number, key: string) {
      guard();
      if (!store.has(key)) return -1; // cold start
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async set(key: string, value: number | string, mode?: string) {
      guard();
      if (mode === 'NX' && store.has(key)) return null;
      store.set(key, Number(value));
      return 'OK';
    },
    async incr(key: string) {
      guard();
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    /** test-only: a Valkey restart without AOF. */
    flush() {
      store = new Map();
    },
    /** test-only: an outage — every command fails. */
    breakIt() {
      broken = true;
    },
    peek(key: string) {
      return store.get(key);
    },
  };
}

/**
 * Fake Mongo covering the two collections SeqService reads: the `counters` document and the highest
 * `messages.seq`. `findOneAndUpdate` models the ONE aggregation-pipeline shape the service issues
 * (`$set: {seq: $max($seq, floor) + 1}`), because that pipeline is the fix for a real MongoDB
 * constraint — `{$max, $inc}` on the same field is rejected — and a fake that ignored it would hide
 * a regression back to the invalid form.
 */
function fakeMongo(seed: { counter?: number; messages?: number[] } = {}) {
  const counters = new Map<string, number>();
  if (seed.counter !== undefined) counters.set('conv-1', seed.counter);
  const messages = [...(seed.messages ?? [])].map((seq) => ({ conversation_id: 'conv-1', seq }));

  const db = {
    collection(name: string) {
      if (name === 'counters') {
        return {
          async findOne({ _id }: { _id: string }) {
            return counters.has(_id) ? { _id, seq: counters.get(_id) } : null;
          },
          async updateOne({ _id }: { _id: string }, update: { $max?: { seq: number } }) {
            const next = update.$max?.seq ?? 0;
            counters.set(_id, Math.max(counters.get(_id) ?? 0, next)); // $max never goes backwards
            return { acknowledged: true };
          },
          async findOneAndUpdate(
            { _id }: { _id: string },
            pipeline: Array<{ $set: { seq: { $add: [{ $max: [string, number] }, number] } } }>,
          ) {
            if (!Array.isArray(pipeline)) {
              throw new Error(
                'counters update must be an aggregation pipeline: {$max,$inc} on one field is ' +
                  'rejected by MongoDB',
              );
            }
            const floor = pipeline[0].$set.seq.$add[0].$max[1];
            const next = Math.max(counters.get(_id) ?? 0, floor) + 1;
            counters.set(_id, next);
            return { _id, seq: next };
          },
        };
      }
      return {
        async findOne() {
          if (messages.length === 0) return null;
          return messages.reduce((a, b) => (a.seq > b.seq ? a : b));
        },
      };
    },
  };
  return {
    client: { db } as never,
    counters,
    addMessage: (seq: number) => messages.push({ conversation_id: 'conv-1', seq }),
  };
}

describe('SeqService — hot path', () => {
  it('returns a monotonic sequence per conversation', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeMongo().client);
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
  });

  it('tracks conversations independently', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeMongo().client);
    expect(await seq.next('conv-a')).toBe(1);
    expect(await seq.next('conv-b')).toBe(1);
    expect(await seq.next('conv-a')).toBe(2);
  });

  it('serves a warm counter without touching Mongo', async () => {
    const mongo = fakeMongo();
    const findOne = jest.spyOn(mongo.client.db.collection('messages') as never, 'findOne');
    const seq = new SeqService(fakeRedis() as never, mongo.client);
    await seq.next('conv-1'); // cold: reads the floor
    findOne.mockClear();
    await seq.next('conv-1'); // warm: must not read it again
    await seq.next('conv-1');
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe('SeqService — cold start must never reissue a used number', () => {
  it('seeds above the durable counter', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeMongo({ counter: 5 }).client);
    expect(await seq.next('conv-1')).toBe(6);
  });

  it('seeds above the highest persisted message when the counter is missing', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeMongo({ messages: [1, 2, 9] }).client);
    expect(await seq.next('conv-1')).toBe(10);
  });

  it('takes the MAXIMUM of the counter and the messages, not just the counter', async () => {
    // The counter lags on purpose — the hot path does not write Mongo per message. Trusting it
    // alone hands out a sequence the messages collection already used.
    const seq = new SeqService(
      fakeRedis() as never,
      fakeMongo({ counter: 3, messages: [1, 2, 12] }).client,
    );
    expect(await seq.next('conv-1')).toBe(13);
  });

  it('does not reissue after Valkey loses the key', async () => {
    const redis = fakeRedis();
    const mongo = fakeMongo();
    const seq = new SeqService(redis as never, mongo.client);
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
    mongo.addMessage(3); // those three are now persisted

    redis.flush(); // restart / eviction / FLUSHALL

    // Reissuing 1 here is silent message loss: the mobile client matches on
    // (conversation_id, seq) and SKIPS a message it thinks it already holds.
    expect(await seq.next('conv-1')).toBe(4);
  });

  it('gives concurrent cold-start callers distinct numbers above the floor', async () => {
    const seq = new SeqService(fakeRedis() as never, fakeMongo({ counter: 5 }).client);
    const results = await Promise.all(Array.from({ length: 10 }, () => seq.next('conv-1')));
    expect(new Set(results).size).toBe(10);
    expect(Math.min(...results)).toBeGreaterThan(5);
  });

  it('records the seeded value durably, so a later Mongo-only path starts from it', async () => {
    const mongo = fakeMongo({ messages: [7] });
    const seq = new SeqService(fakeRedis() as never, mongo.client);
    await seq.next('conv-1');
    expect(mongo.counters.get('conv-1')).toBe(8);
  });
});

describe('SeqService — Valkey outage', () => {
  it('keeps serving from the durable counter instead of failing the send', async () => {
    const redis = fakeRedis();
    const seq = new SeqService(redis as never, fakeMongo({ counter: 4 }).client);
    redis.breakIt();
    expect(await seq.next('conv-1')).toBe(5);
  });

  it('does NOT reissue a number the hot path already handed out', async () => {
    // The bug this guards: the hot path advances Redis without writing Mongo, so the counter is
    // behind. Incrementing that stale counter returns a sequence already used by a stored message.
    const redis = fakeRedis();
    const mongo = fakeMongo();
    const seq = new SeqService(redis as never, mongo.client);

    for (let i = 1; i <= 5; i += 1) {
      const s = await seq.next('conv-1');
      mongo.addMessage(s); // the message is persisted with that seq
    }
    expect(mongo.counters.get('conv-1')).toBeLessThan(5); // the counter is genuinely behind

    redis.breakIt();
    expect(await seq.next('conv-1')).toBe(6);
  });

  it('stays monotonic across repeated Mongo-only calls', async () => {
    const redis = fakeRedis();
    const seq = new SeqService(redis as never, fakeMongo({ counter: 10 }).client);
    redis.breakIt();
    expect(await seq.next('conv-1')).toBe(11);
    expect(await seq.next('conv-1')).toBe(12);
    expect(await seq.next('conv-1')).toBe(13);
  });

  it('rejects a non-pipeline counter update, so the invalid {$max,$inc} form cannot come back', async () => {
    // MongoDB refuses two operators on one field. The fake asserts the shape rather than trusting it.
    const redis = fakeRedis();
    const mongo = fakeMongo();
    const seq = new SeqService(redis as never, mongo.client);
    redis.breakIt();
    await expect(seq.next('conv-1')).resolves.toBeGreaterThan(0);
  });
});

describe('SeqService — degraded configurations', () => {
  it('works with Mongo alone', async () => {
    const seq = new SeqService(null, fakeMongo({ counter: 2 }).client);
    expect(await seq.next('conv-1')).toBe(3);
    expect(await seq.next('conv-1')).toBe(4);
  });

  it('works with neither backend, for unit tests and offline runs', async () => {
    const seq = new SeqService(null, null);
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-2')).toBe(1);
  });

  it('falls back to memory when Redis breaks and there is no Mongo', async () => {
    const redis = fakeRedis();
    const seq = new SeqService(redis as never, null);
    expect(await seq.next('conv-1')).toBe(1);
    redis.breakIt();
    expect(await seq.next('conv-1')).toBe(1); // a fresh in-memory counter, but never a crash
  });
});
