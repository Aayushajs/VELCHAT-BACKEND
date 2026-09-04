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

  /**
   * The projection has to satisfy `MembershipResolver` so `WsFabric` can authorize inbound frames
   * from it. Without an `isMember`, a deployment that owns conversations in-process (mono) has no
   * resolver to pass at all — and `mayAct()` fails closed, so EVERY `delivered`, `read`, `typing`
   * and `skdm` frame is refused. That is "blue ticks and typing never work", with the fabric
   * behaving exactly as designed.
   */
  describe('isMember (MembershipResolver port)', () => {
    it('confirms a member and denies a non-member', async () => {
      const proj = new MembershipProjection(fakeRedis());
      await proj.seed('c1', ['a', 'b']);
      await expect(proj.isMember('c1', 'a')).resolves.toBe(true);
      await expect(proj.isMember('c1', 'stranger')).resolves.toBe(false);
    });

    it('fails CLOSED when membership cannot be determined', async () => {
      const proj = new MembershipProjection(fakeRedis()); // cold, no HTTP fallback configured
      await expect(proj.isMember('never-seen', 'a')).resolves.toBe(false);
    });

    it('denies on empty ids rather than consulting the projection', async () => {
      const proj = new MembershipProjection(fakeRedis());
      await proj.seed('c1', ['a']);
      await expect(proj.isMember('', 'a')).resolves.toBe(false);
      await expect(proj.isMember('c1', '')).resolves.toBe(false);
    });
  });
});
