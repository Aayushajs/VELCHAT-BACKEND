import { SeqService } from '../../src/chat/seq.service';

function fakeRedis() {
  const store = new Map<string, string | number>();
  return {
    async eval(_script: string, _numKeys: number, key: string) {
      if (store.has(key)) {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }
      return -1;
    },
    async set(key: string, val: number | string, mode?: string) {
      if (mode === 'NX' && store.has(key)) {
        return null;
      }
      store.set(key, val);
      return 'OK';
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    _store: store,
  } as never;
}

function fakeMongo(initialCounters: Record<string, number> = {}) {
  const counters = new Map<string, number>(Object.entries(initialCounters));
  const messages: { conversation_id: string; seq: number }[] = [];

  return {
    db: {
      collection(name: string) {
        if (name === 'counters') {
          return {
            async findOne(filter: { _id: string }) {
              const seq = counters.get(filter._id);
              return seq !== undefined ? { _id: filter._id, seq } : null;
            },
            async findOneAndUpdate(filter: { _id: string }, update: { $inc: { seq: number } }) {
              const current = counters.get(filter._id) ?? 0;
              const next = current + (update.$inc.seq ?? 1);
              counters.set(filter._id, next);
              return { _id: filter._id, seq: next };
            },
            async updateOne(filter: { _id: string }, update: { $max: { seq: number } }) {
              const current = counters.get(filter._id) ?? 0;
              const next = Math.max(current, update.$max.seq);
              counters.set(filter._id, next);
            },
          };
        }
        if (name === 'messages') {
          return {
            async findOne(filter: { conversation_id: string }) {
              const msgs = messages.filter((m) => m.conversation_id === filter.conversation_id);
              if (msgs.length === 0) return null;
              return msgs.sort((a, b) => b.seq - a.seq)[0];
            },
          };
        }
        return {} as never;
      },
    },
  } as never;
}

describe('SeqService (§B4.3 per-conversation order & recovery)', () => {
  it('returns a monotonic seq per conversation with Redis', async () => {
    const seq = new SeqService(fakeRedis(), fakeMongo());
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
  });

  it('tracks conversations independently', async () => {
    const seq = new SeqService(fakeRedis(), fakeMongo());
    expect(await seq.next('conv-a')).toBe(1);
    expect(await seq.next('conv-b')).toBe(1);
    expect(await seq.next('conv-a')).toBe(2);
  });

  it('recovers sequence from MongoDB after Redis cold start or key eviction', async () => {
    const mongo = fakeMongo({ 'conv-existing': 42 });
    const redis = fakeRedis(); // empty Redis
    const seq = new SeqService(redis, mongo);

    // First call: Redis cache miss -> reads 42 from Mongo -> sets 43 in Redis & returns 43
    expect(await seq.next('conv-existing')).toBe(43);
    // Subsequent call: hits Redis cache -> returns 44
    expect(await seq.next('conv-existing')).toBe(44);
  });

  it('works durably with standalone MongoDB when Redis is unavailable', async () => {
    const mongo = fakeMongo({ 'conv-durable': 10 });
    const seq = new SeqService(null, mongo);

    expect(await seq.next('conv-durable')).toBe(11);
    expect(await seq.next('conv-durable')).toBe(12);
  });
});
