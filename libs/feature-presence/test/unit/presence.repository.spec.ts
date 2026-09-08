import { PresenceRepository } from '../../src/presence/presence.repository';

/**
 * A Redis fake with the one semantic that matters here: EXPIRE does NOTHING and returns 0 when
 * the key is gone. A fake that always succeeds hides this whole class of bug, which is why the
 * connection-registry fake models it the same way.
 */
function fakeRedis() {
  const sets = new Map<string, Set<string>>();
  const strings = new Map<string, string>();
  return {
    async sadd(key: string, value: string) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(value);
      sets.set(key, s);
      return 1;
    },
    async srem(key: string, value: string) {
      sets.get(key)?.delete(value);
      return 1;
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
    async expire(key: string) {
      return sets.has(key) ? 1 : 0;
    },
    async set(key: string, value: string) {
      strings.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return strings.get(key) ?? null;
    },
    /** Test hook: the TTL lapsing while the app is still open and heartbeating. */
    __expireNow(key: string) {
      sets.delete(key);
    },
  };
}

describe('PresenceRepository (§B8)', () => {
  it('a heartbeat RE-ADDS a device whose TTL has lapsed', async () => {
    // The bug this pins. `heartbeat` called EXPIRE alone, and `addDevice` runs only when the
    // client announces itself. The TTL is 30s against a 20s heartbeat, so ONE late beat — a
    // throttled background timer, a radio waking up, a busy JS thread — dropped the key, and
    // every heartbeat after that was a no-op against a key that no longer existed. The user then
    // read as offline for the rest of the session while their app sat open: contacts saw a stale
    // "last seen", and the notification policy pushed to a user who was right there.
    const redis = fakeRedis();
    const repo = new PresenceRepository(redis as never);

    await repo.addDevice('u1', 'd1');
    expect(await repo.onlineCount('u1')).toBe(1);

    redis.__expireNow('online:u1'); // the TTL lapses; the app is still open
    expect(await repo.onlineCount('u1')).toBe(0);

    await repo.heartbeat('u1', 'd1'); // the next beat arrives
    expect(await repo.onlineCount('u1')).toBe(1);
  });

  it('a heartbeat does not duplicate a device that is still present', async () => {
    const repo = new PresenceRepository(fakeRedis() as never);
    await repo.addDevice('u1', 'd1');
    await repo.heartbeat('u1', 'd1');
    await repo.heartbeat('u1', 'd1');
    expect(await repo.onlineCount('u1')).toBe(1);
  });

  it('two devices stay independent across a lapse', async () => {
    const redis = fakeRedis();
    const repo = new PresenceRepository(redis as never);
    await repo.addDevice('u1', 'phone');
    await repo.addDevice('u1', 'laptop');
    redis.__expireNow('online:u1');

    // Only the phone beats. The laptop is genuinely gone — its own heartbeat stopped — so
    // recovering just the beating device is the correct answer, not restoring both.
    await repo.heartbeat('u1', 'phone');
    expect(await repo.onlineCount('u1')).toBe(1);
  });

  it('a heartbeat with no device id still refreshes an existing key', async () => {
    // An older client sends `{userId}` only. It must keep working — just without the ability to
    // recover from a lapse, which is the old behaviour and no worse than it was.
    const redis = fakeRedis();
    const repo = new PresenceRepository(redis as never);
    await repo.addDevice('u1', 'd1');
    await repo.heartbeat('u1');
    expect(await repo.onlineCount('u1')).toBe(1);

    redis.__expireNow('online:u1');
    await repo.heartbeat('u1');
    expect(await repo.onlineCount('u1')).toBe(0);
  });

  it('going offline records a last-seen only when the last device leaves', async () => {
    const repo = new PresenceRepository(fakeRedis() as never);
    await repo.addDevice('u1', 'phone');
    await repo.addDevice('u1', 'laptop');

    expect(await repo.removeDevice('u1', 'phone')).toBe(1);
    expect(await repo.lastSeen('u1')).toBeNull();

    expect(await repo.removeDevice('u1', 'laptop')).toBe(0);
    expect(await repo.lastSeen('u1')).not.toBeNull();
  });
});
