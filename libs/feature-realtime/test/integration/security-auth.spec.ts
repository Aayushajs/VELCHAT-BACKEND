import { MembershipProjection } from '../../src/fanout/membership-projection';
import { TypingRelay } from '../../src/fanout/typing-relay';
import { ReceiptPublisher } from '../../src/fanout/receipt-publisher';
import { EventRouter } from '../../src/fabric/event-router';

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
      return set.delete(member) ? 1 : 0;
    },
    async smembers(key: string) {
      const set = store.get(key);
      return set ? Array.from(set) : [];
    },
    _store: store,
  };
}

function createMockEventBus() {
  const published: Array<{ topic: string; envelope: unknown }> = [];
  return {
    publish: async (topic: string, envelope: unknown) => {
      published.push({ topic, envelope });
    },
    _published: published,
  };
}

describe('Security & Membership Authorization Hardening', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let projection: MembershipProjection;
  let routedFrames: Array<{ recipients: string[]; frame: unknown }>;
  let router: EventRouter;

  beforeEach(async () => {
    redis = createMockRedis();
    projection = new MembershipProjection(redis as never);
    routedFrames = [];
    router = {
      route: async (recipients: string[], frame: unknown) => {
        routedFrames.push({ recipients, frame });
        return recipients.length;
      },
    } as never;

    // Seed conversation with User-1 and User-2
    await projection.seed('conv-secret-room', ['user-1', 'user-2']);
  });

  it('rejects typing signal from an unauthorized non-member (attacker)', async () => {
    const typing = new TypingRelay(projection, router);

    // Attacker (user-evil) tries to send typing frame to conv-secret-room
    const routed = await typing.relay('user-evil', 'conv-secret-room', 'start');

    // Should be rejected: 0 recipients routed, nothing dispatched
    expect(routed).toBe(0);
    expect(routedFrames).toHaveLength(0);

    // Legitimate member sends typing
    const legitimateRouted = await typing.relay('user-1', 'conv-secret-room', 'start');
    expect(legitimateRouted).toBe(1);
    expect(routedFrames).toHaveLength(1);
    expect(routedFrames[0]!.recipients).toEqual(['user-2']);
  });

  it('rejects receipt publishing from an unauthorized non-member (attacker)', async () => {
    const bus = createMockEventBus();
    const receipts = new ReceiptPublisher(bus as never, projection);

    // Attacker (user-evil) tries to mark messages as read in conv-secret-room
    await receipts.read('user-evil', 'conv-secret-room', 100);

    // Should NOT publish any event to the bus
    expect(bus._published).toHaveLength(0);

    // Legitimate member sends read ack
    await receipts.read('user-2', 'conv-secret-room', 100);
    expect(bus._published).toHaveLength(1);
    expect(bus._published[0]!.topic).toBe('message.read');
  });
});
