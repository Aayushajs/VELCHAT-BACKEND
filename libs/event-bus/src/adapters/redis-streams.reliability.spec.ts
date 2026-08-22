import pino from 'pino';
import { buildEnvelope, IdempotencyStore } from '@velchat/common';
import { RedisStreamsEventBus } from './redis-streams.bus';
import { FakeRedisStreams } from './fake-redis-streams';

const logger = pino({ level: 'silent' });
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function busOn(redis: FakeRedisStreams) {
  // The adapter builds its own ioredis internally, so the fake replaces it. `idempotency` has to be
  // rebuilt too: the store captures the client at CONSTRUCTION, so swapping only `pub` would leave
  // the dedupe check pointed at a client that never connects — and it would hang there, not fail.
  const bus = new RedisStreamsEventBus('redis://unused', logger, { blockMs: 25 }) as unknown as {
    pub: unknown;
    idempotency: unknown;
    connect(): Promise<void>;
    close(): Promise<void>;
    publish(topic: string, e: unknown): Promise<void>;
    subscribe(topic: string, group: string, h: (e: unknown) => Promise<void>): void;
    start(): Promise<void>;
  };
  bus.pub = redis;
  bus.idempotency = new IdempotencyStore(redis as never, 'evt-idem');
  return bus;
}

const event = (n: number) =>
  buildEnvelope({ eventType: 'message.sent', key: 'conv-1', payload: { n }, producer: 'test' });

/**
 * The event bus is the delivery guarantee for everything downstream — fan-out, notifications,
 * search indexing. Three defects the audit found here are all data-loss shaped, and none of them
 * were covered by a test, which is why they survived:
 *
 *   DEF-03  idempotency was marked BEFORE the handler ran, so a crash mid-handling recorded the
 *           event as processed and it was skipped on redelivery.
 *   DEF-04  no XAUTOCLAIM, so an entry delivered but never acknowledged stayed in the pending list
 *           forever and nobody ever processed it.
 *   DEF-05  a handler error went straight to the DLQ on the FIRST failure, so one transient Mongo
 *           blip permanently diverted a message fan-out.
 */
describe('RedisStreamsEventBus reliability', () => {
  it('delivers a published event to its subscriber', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    const seen: unknown[] = [];
    bus.subscribe('message.sent', 'g1', async (e) => {
      seen.push(e);
    });
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle();
    await bus.close();

    expect(seen).toHaveLength(1);
  });

  it('acknowledges a handled event so it leaves the pending list', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    bus.subscribe('message.sent', 'g1', async () => {});
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle();
    await bus.close();

    expect(redis.pendingIds('message.sent', 'g1')).toHaveLength(0);
  });

  it('REPROCESSES an event whose handler crashed, instead of skipping it (DEF-03)', async () => {
    // Marking idempotency before handling means a crash loses the event permanently: the redelivery
    // sees it as already processed. The mark must happen only after the handler succeeds.
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let attempts = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('mongo blip');
    });
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle(400);
    await bus.close();

    expect(attempts).toBeGreaterThan(1);
  });

  it('retries a failing handler before giving up on it (DEF-05)', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let attempts = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      attempts += 1;
      throw new Error('always fails');
    });
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle(600);
    await bus.close();

    // Bounded, not infinite: a permanently poisonous event must still end up in the DLQ.
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(5);
    expect(redis.entries('message.sent.dlq').length).toBe(1);
  });

  it('does not DLQ an event on its FIRST transient failure (DEF-05)', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let attempts = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('transient');
    });
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle(400);
    await bus.close();

    expect(redis.entries('message.sent.dlq')).toHaveLength(0);
  });

  it('reclaims an entry that was handled but never acknowledged (DEF-04)', async () => {
    // The crash-after-handle case: the handler ran, then the process died before XACK. Without
    // XAUTOCLAIM the entry is stranded in the pending list forever. Reclaiming it must drain the
    // list WITHOUT re-running the handler — the work is already done, and repeating it would be a
    // duplicate side effect (a second push notification, a second index write).
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let handled = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      handled += 1;
    });
    await bus.connect();
    await bus.start();

    redis.failNextAck = true;
    await bus.publish('message.sent', event(1));
    await settle(150);
    expect(handled).toBe(1);
    expect(redis.pendingIds('message.sent', 'g1')).toHaveLength(1); // stranded

    redis.ageOutPending('message.sent', 'g1', 120_000);
    await settle(1500);
    await bus.close();

    expect(redis.pendingIds('message.sent', 'g1')).toHaveLength(0); // drained
    expect(handled).toBe(1); // and NOT re-run
  });

  it('reclaims and REPROCESSES an entry abandoned before its handler finished (DEF-04)', async () => {
    // The genuine data-loss case: the entry was delivered but the handler never completed, so
    // idempotency was never marked. Reclaiming it has to actually run the work this time.
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let attempts = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      attempts += 1;
      if (attempts <= 3) throw new Error('down'); // exhausts the retries → DLQ + ack
    });
    await bus.connect();
    await bus.start();
    await bus.publish('message.sent', event(1));
    await settle(500);

    // Nothing is left pending, and the failure is captured rather than lost silently.
    expect(redis.pendingIds('message.sent', 'g1')).toHaveLength(0);
    expect(redis.entries('message.sent.dlq')).toHaveLength(1);
    await bus.close();
  });

  it('sends an unparseable entry straight to the DLQ without retrying it', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    bus.subscribe('message.sent', 'g1', async () => {});
    await bus.connect();
    await bus.start();
    await redis.xadd('message.sent', '*', 'e', 'not-json');
    await settle(200);
    await bus.close();

    // Retrying a malformed payload can never succeed, so it is not worth the attempts.
    expect(redis.entries('message.sent.dlq')).toHaveLength(1);
  });

  it('handles a duplicate event once', async () => {
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    let handled = 0;
    bus.subscribe('message.sent', 'g1', async () => {
      handled += 1;
    });
    await bus.connect();
    await bus.start();
    const dup = event(1);
    await bus.publish('message.sent', dup);
    await bus.publish('message.sent', dup); // same event_id
    await settle(200);
    await bus.close();

    expect(handled).toBe(1);
  });

  it('tolerates a group that already exists (BUSYGROUP)', async () => {
    const redis = new FakeRedisStreams();
    await redis.xgroup('CREATE', 'message.sent', 'g1');
    const bus = busOn(redis);
    bus.subscribe('message.sent', 'g1', async () => {});
    await bus.connect();
    await expect(bus.start()).resolves.toBeUndefined();
    await bus.close();
  });

  it('multiplexes one read across every topic in a consumer group (DEF-08)', async () => {
    // 23 subscriptions each with their own connection and their own blocking read produced ~397k
    // idle commands/day. One read per GROUP is what makes the idle cost negligible.
    const redis = new FakeRedisStreams();
    const bus = busOn(redis);
    for (const topic of ['message.sent', 'message.edited', 'message.deleted']) {
      bus.subscribe(topic, 'shared-group', async () => {});
    }
    await bus.connect();
    await bus.start();
    await settle(150);
    await bus.close();

    // Three topics, one group ⇒ far fewer reads than one-per-subscription would issue.
    const reads = redis.calls.filter((c) => c === 'xreadgroup').length;
    expect(reads).toBeLessThan(3 * 3);
  });
});
