import { ConnectionRegistry } from './connection-registry';

function fakeRedis(): never & { __expireNow(key: string): void } {
  const sets = new Map<string, Set<string>>();
  return {
    async sadd(key: string, value: string) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(value);
      sets.set(key, s);
      return 1;
    },
    async smembers(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    async srem(key: string, value: string) {
      sets.get(key)?.delete(value);
      return 1;
    },
    // EXPIRE returns 0 and does NOTHING when the key does not exist. Modelling that is the
    // whole point of this fake — the bug it exposes was invisible to a fake that always
    // succeeded.
    async expire(key: string) {
      return sets.has(key) ? 1 : 0;
    },
    /** Test hook: simulate the TTL lapsing while the socket stays open. */
    __expireNow(key: string) {
      sets.delete(key);
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
  } as never;
}

describe('ConnectionRegistry (§B9.1)', () => {
  it('a heartbeat RE-ADDS a connection whose TTL has lapsed', async () => {
    // The bug this pins: `heartbeat` used to call EXPIRE alone, and EXPIRE on an expired key does
    // nothing. `register` only runs on connect, so a socket whose heartbeats paused for longer
    // than the TTL — a backgrounded app, a sleeping radio — was gone from the registry for the
    // rest of its life while staying connected. The server then treated that user as offline
    // forever: fan-out could not reach their sockets, so the sender's ticks never advanced past
    // one, and every message also pushed to a user who was online.
    const redis = fakeRedis();
    const reg = new ConnectionRegistry(redis);
    const conn = { podId: 'pod-A', connId: 'c1', deviceId: 'd1' };

    await reg.register('u1', conn);
    expect(await reg.isOnline('u1')).toBe(true);

    redis.__expireNow('conn:u1'); // the TTL lapses; the WebSocket is still open
    expect(await reg.isOnline('u1')).toBe(false);

    await reg.heartbeat('u1', conn); // the next ping arrives
    expect(await reg.isOnline('u1')).toBe(true);
    expect(await reg.podsFor('u1')).toEqual(['pod-A']);
  });

  it('a heartbeat does not duplicate a connection that is still present', async () => {
    const reg = new ConnectionRegistry(fakeRedis());
    const conn = { podId: 'pod-A', connId: 'c1', deviceId: 'd1' };
    await reg.register('u1', conn);
    await reg.heartbeat('u1', conn);
    await reg.heartbeat('u1', conn);
    expect(await reg.connectionsFor('u1')).toHaveLength(1);
  });

  it('registers a connection and reports it online', async () => {
    const reg = new ConnectionRegistry(fakeRedis());
    await reg.register('u1', { podId: 'pod-A', connId: 'c1', deviceId: 'd1' });
    expect(await reg.isOnline('u1')).toBe(true);
    expect(await reg.podsFor('u1')).toEqual(['pod-A']);
  });

  it('dedupes pods across multiple connections', async () => {
    const reg = new ConnectionRegistry(fakeRedis());
    await reg.register('u1', { podId: 'pod-A', connId: 'c1', deviceId: 'd1' });
    await reg.register('u1', { podId: 'pod-A', connId: 'c2', deviceId: 'd2' });
    await reg.register('u1', { podId: 'pod-B', connId: 'c3', deviceId: 'd3' });
    expect((await reg.podsFor('u1')).sort()).toEqual(['pod-A', 'pod-B']);
    expect(await reg.connectionsFor('u1')).toHaveLength(3);
  });

  it('unregisters a connection by connId', async () => {
    const reg = new ConnectionRegistry(fakeRedis());
    await reg.register('u1', { podId: 'pod-A', connId: 'c1', deviceId: 'd1' });
    await reg.unregister('u1', 'c1');
    expect(await reg.isOnline('u1')).toBe(false);
  });
});
