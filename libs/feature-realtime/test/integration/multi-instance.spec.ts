import { ConnectionRegistry } from '../../src/fabric/connection-registry';
import { EventRouter } from '../../src/fabric/event-router';
import type { PodPublisher } from '../../src/fabric/event-router';

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

describe('Multi-Instance Cross-Pod Delivery (§B9.2)', () => {
  it('routes message from Gateway A to Gateway C when User B is connected to Gateway C', async () => {
    const redis = createMockRedis();
    const registry = new ConnectionRegistry(redis);

    // Register User A on Pod Gateway-A
    await registry.register('user-a', {
      podId: 'gateway-a',
      connId: 'conn-a-1',
      deviceId: 'device-a-phone',
    });

    // Register User B on Pod Gateway-C
    await registry.register('user-b', {
      podId: 'gateway-c',
      connId: 'conn-c-1',
      deviceId: 'device-b-web',
    });

    // Published frames captured per pod channel
    const publishedFrames: Array<{ podId: string; envelope: unknown }> = [];
    const podPublisher: PodPublisher = {
      async publishToPod(podId, envelope) {
        publishedFrames.push({ podId, envelope });
      },
    };

    const router = new EventRouter(registry, podPublisher);

    // Gateway-A fanout router receives an event directed to User B
    const frame = {
      kind: 'durable' as const,
      type: 'message',
      data: {
        conversationId: 'conv-123',
        messageId: 'msg-999',
        senderId: 'user-a',
        content: 'Hello User B across pods!',
        seq: 1,
      },
    };

    const routedCount = await router.route(['user-b'], frame);

    // Verify 1 pod route dispatched
    expect(routedCount).toBe(1);
    expect(publishedFrames).toHaveLength(1);
    expect(publishedFrames[0]!.podId).toBe('gateway-c');
    expect(publishedFrames[0]!.envelope).toMatchObject({
      recipients: ['user-b'],
      frame,
    });
  });
});
