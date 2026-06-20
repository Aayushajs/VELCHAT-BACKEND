import { IdempotencyStore } from './idempotency';
import type { Redis } from 'ioredis';

// Minimal in-memory fake of the ioredis surface we use (SET NX EX + EXISTS).
function fakeRedis(): Redis {
  const store = new Set<string>();
  return {
    async set(
      key: string,
      _v: string,
      _ex: string,
      _ttl: number,
      nx: string,
    ): Promise<'OK' | null> {
      if (nx === 'NX' && store.has(key)) return null;
      store.add(key);
      return 'OK';
    },
    async exists(key: string): Promise<number> {
      return store.has(key) ? 1 : 0;
    },
  } as unknown as Redis;
}

describe('IdempotencyStore (§A11 at-most-once)', () => {
  it('markIfNew returns true once, false on duplicate', async () => {
    const idem = new IdempotencyStore(fakeRedis());
    expect(await idem.markIfNew('evt-1')).toBe(true);
    expect(await idem.markIfNew('evt-1')).toBe(false);
    expect(await idem.markIfNew('evt-2')).toBe(true);
  });

  it('wasProcessed reflects prior marking', async () => {
    const idem = new IdempotencyStore(fakeRedis());
    expect(await idem.wasProcessed('evt-1')).toBe(false);
    await idem.markIfNew('evt-1');
    expect(await idem.wasProcessed('evt-1')).toBe(true);
  });
});
