import type { Redis } from 'ioredis';
import { SkdmStore } from './skdm-store';

/** In-memory stand-in for the Redis list ops the store uses. */
function fakeRedis(): Redis {
  const lists = new Map<string, string[]>();
  const get = (k: string): string[] => lists.get(k) ?? lists.set(k, []).get(k)!;
  return {
    async rpush(key: string, val: string) {
      get(key).push(val);
      return get(key).length;
    },
    async ltrim(key: string, start: number, stop: number) {
      const l = get(key);
      const norm = (i: number) => (i < 0 ? l.length + i : i);
      lists.set(key, l.slice(norm(start), norm(stop) + 1));
      return 'OK';
    },
    async expire() {
      return 1;
    },
    async lrange(key: string, start: number, stop: number) {
      const l = get(key);
      return l.slice(start, stop === -1 ? undefined : stop + 1);
    },
    async del(key: string) {
      const had = lists.has(key);
      lists.delete(key);
      return had ? 1 : 0;
    },
  } as unknown as Redis;
}

describe('SkdmStore (§G1-2 per-device queue)', () => {
  it('queues SKDMs and drains them once', async () => {
    const store = new SkdmStore(fakeRedis());
    await store.enqueue('u1', 'devA', { epoch: 2, ciphertext: 'a' });
    await store.enqueue('u1', 'devA', { epoch: 2, ciphertext: 'b' });
    const drained = await store.drain('u1', 'devA');
    expect(drained).toEqual([
      { epoch: 2, ciphertext: 'a' },
      { epoch: 2, ciphertext: 'b' },
    ]);
    expect(await store.drain('u1', 'devA')).toEqual([]); // cleared after draining
  });

  it('isolates queues per device', async () => {
    const store = new SkdmStore(fakeRedis());
    await store.enqueue('u1', 'devA', { ciphertext: 'a' });
    expect(await store.drain('u1', 'devB')).toEqual([]);
  });
});
