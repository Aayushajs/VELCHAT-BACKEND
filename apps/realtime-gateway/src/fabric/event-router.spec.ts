import { EventRouter, type PodPublisher } from './event-router';
import type { ConnectionRegistry } from './connection-registry';

describe('EventRouter (§B9.2 fan-out)', () => {
  it('publishes to every pod holding a recipient socket', async () => {
    const podsByUser: Record<string, string[]> = { u1: ['pod-A'], u2: ['pod-A', 'pod-B'] };
    const registry = {
      podsFor: async (u: string) => podsByUser[u] ?? [],
    } as unknown as ConnectionRegistry;

    const published: Array<{ podId: string; userId: string }> = [];
    const pub: PodPublisher = {
      async publishToPod(podId, env) {
        published.push({ podId, userId: env.userId });
      },
    };

    const router = new EventRouter(registry, pub);
    const deliveries = await router.route(['u1', 'u2'], { type: 'message', seq: 1 });

    expect(deliveries).toBe(3); // u1→pod-A, u2→pod-A, u2→pod-B
    expect(published.map((p) => p.podId).sort()).toEqual(['pod-A', 'pod-A', 'pod-B']);
    // each delivery carries the recipient so the owning pod routes to the right socket
    expect(published.filter((p) => p.userId === 'u2').length).toBe(2);
  });

  it('skips offline recipients (no pods)', async () => {
    const registry = { podsFor: async () => [] } as unknown as ConnectionRegistry;
    const router = new EventRouter(registry, { async publishToPod() {} });
    expect(await router.route(['offline-user'], {})).toBe(0);
  });
});
