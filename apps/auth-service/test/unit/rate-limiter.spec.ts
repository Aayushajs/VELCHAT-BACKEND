import { RateLimiter } from '../../src/auth/abuse/rate-limiter';

function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    async incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  } as never;
}

describe('RateLimiter (§B2.8 anti-pumping)', () => {
  it('allows up to the limit then blocks', async () => {
    const rl = new RateLimiter(fakeRedis());
    expect(await rl.allow('ip:1', 3, 60)).toBe(true);
    expect(await rl.allow('ip:1', 3, 60)).toBe(true);
    expect(await rl.allow('ip:1', 3, 60)).toBe(true);
    expect(await rl.allow('ip:1', 3, 60)).toBe(false);
  });

  it('tracks keys independently', async () => {
    const rl = new RateLimiter(fakeRedis());
    expect(await rl.allow('ip:a', 1, 60)).toBe(true);
    expect(await rl.allow('ip:b', 1, 60)).toBe(true);
    expect(await rl.allow('ip:a', 1, 60)).toBe(false);
  });
});
