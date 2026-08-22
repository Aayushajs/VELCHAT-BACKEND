import { ConnectionRegistry } from './connection-registry';

function fakeRedis() {
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
    async expire() {
      return 1;
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
  } as never;
}

describe('ConnectionRegistry (§B9.1)', () => {
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
