import type { Redis } from 'ioredis';
import { MembershipProjection } from './membership-projection';

/** Minimal in-memory stand-in for the Valkey set commands the projection uses. */
function fakeRedis(): Redis {
  const sets = new Map<string, Set<string>>();
  const get = (k: string): Set<string> => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  return {
    async sadd(key: string, ...members: string[]) {
      const s = get(key);
      members.forEach((m) => s.add(m));
      return members.length;
    },
    async srem(key: string, member: string) {
      return get(key).delete(member) ? 1 : 0;
    },
    async smembers(key: string) {
      return [...get(key)];
    },
  } as unknown as Redis;
}

describe('MembershipProjection (§A10.5 event-sourced)', () => {
  it('seeds, adds, removes and lists members', async () => {
    const proj = new MembershipProjection(fakeRedis());
    await proj.seed('c1', ['a', 'b']);
    await proj.add('c1', 'c');
    await proj.remove('c1', 'a');
    expect((await proj.members('c1')).sort()).toEqual(['b', 'c']);
  });

  it('seed with no members is a no-op (empty SADD would error)', async () => {
    const proj = new MembershipProjection(fakeRedis());
    await proj.seed('c2', []);
    expect(await proj.members('c2')).toEqual([]);
  });

  it('returns empty for an unknown conversation (cold projection)', async () => {
    const proj = new MembershipProjection(fakeRedis());
    expect(await proj.members('never-seen')).toEqual([]);
  });
});
