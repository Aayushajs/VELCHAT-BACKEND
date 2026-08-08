import { ConnectionRegistry } from '../../src/fabric/connection-registry';

function createMockRedis() {
  const store = new Map<string, Set<string>>();

  return {
    async sadd(key: string, ...members: string[]) {
      let set = store.get(key);
      if (!set) {
        set = new Set();
        store.set(key, set);
      }
      for (const m of members) set.add(m);
      return members.length;
    },
    async srem(key: string, member: string) {
      const set = store.get(key);
      if (!set) return 0;
      const res = set.delete(member);
      return res ? 1 : 0;
    },
    async smembers(key: string) {
      const set = store.get(key);
      return set ? Array.from(set) : [];
    },
    async scard(key: string) {
      const set = store.get(key);
      return set ? set.size : 0;
    },
    async expire() {
      return 1;
    },
    _store: store,
  } as never;
}

describe('Multi-Device Support & Connection Registry Lifecycle (§B5.3 / §B9)', () => {
  it('tracks multiple devices per user without marking user offline on single device disconnect', async () => {
    const redis = createMockRedis();
    const registry = new ConnectionRegistry(redis, 75);

    const userId = 'user-multidevice';

    await registry.register(userId, {
      podId: 'pod-1',
      connId: 'conn-phone',
      deviceId: 'device-phone',
    });

    await registry.register(userId, {
      podId: 'pod-2',
      connId: 'conn-web',
      deviceId: 'device-web',
    });

    await registry.register(userId, {
      podId: 'pod-1',
      connId: 'conn-tablet',
      deviceId: 'device-tablet',
    });

    expect(await registry.isOnline(userId)).toBe(true);
    expect(await registry.connectionsFor(userId)).toHaveLength(3);

    const pods = await registry.podsFor(userId);
    expect(pods).toEqual(expect.arrayContaining(['pod-1', 'pod-2']));
    expect(pods).toHaveLength(2);

    await registry.unregister(userId, 'conn-web');

    expect(await registry.isOnline(userId)).toBe(true);
    expect(await registry.connectionsFor(userId)).toHaveLength(2);

    const remainingPods = await registry.podsFor(userId);
    expect(remainingPods).toEqual(['pod-1']);

    await registry.unregister(userId, 'conn-phone');
    await registry.unregister(userId, 'conn-tablet');

    expect(await registry.isOnline(userId)).toBe(false);
    expect(await registry.connectionsFor(userId)).toHaveLength(0);
  });
});
