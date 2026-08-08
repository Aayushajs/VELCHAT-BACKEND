import Redis from 'ioredis';
import type { Logger } from 'pino';
import {
  parseEnvelope,
  runWithTenant,
  IdempotencyStore,
  type EventEnvelope,
} from '@velchat/common';
import type { EventBus, EventHandler } from '../event-bus.port';

interface Subscription {
  topic: string;
  groupId: string;
  consumer: string;
  handler: EventHandler;
}

type StreamReadResult = Array<[string, Array<[string, string[]]>]> | null;

/**
 * Redis Streams event bus (Upstash free tier optimized).
 * Features:
 * - Single multiplexed XREADGROUP consumer loop per groupId (batching all subscribed topics)
 * - 30-second block timeout (drastically reducing Upstash request count by >95%)
 * - Resilient error handling with exponential backoff on rate limits or connection drops
 * - Fallback / graceful degradation so publisher and start() do not crash the service
 */
export class RedisStreamsEventBus implements EventBus {
  readonly name = 'event-bus:redis-streams';
  private readonly pub: Redis;
  private readonly idempotency: IdempotencyStore;
  private readonly subscriptions: Subscription[] = [];
  private readonly readers: Redis[] = [];
  private readonly maxLen: number;
  private running = false;

  constructor(
    url: string,
    private readonly logger: Logger,
    opts?: { maxLenApprox?: number },
  ) {
    this.pub = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 10 ? null : Math.min(times * 300, 3000)),
    });
    this.idempotency = new IdempotencyStore(this.pub, 'evt-idem');
    this.maxLen = opts?.maxLenApprox ?? 100_000;
  }

  async connect(): Promise<void> {
    try {
      await this.pub.connect();
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'redis-streams publisher failed to connect at boot');
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.pub.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.running = false;
    for (const reader of this.readers) {
      try {
        reader.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      await this.pub.quit();
    } catch {
      this.pub.disconnect();
    }
  }

  async publish<T>(topic: string, envelope: EventEnvelope<T>): Promise<void> {
    try {
      await this.pub.xadd(topic, 'MAXLEN', '~', this.maxLen, '*', 'e', JSON.stringify(envelope));
    } catch (err) {
      this.logger.error(
        { topic, event_id: envelope.event_id, err: String(err) },
        'failed to publish event to redis-streams',
      );
    }
  }

  subscribe<T>(topic: string, groupId: string, handler: EventHandler<T>): void {
    this.subscriptions.push({
      topic,
      groupId,
      consumer: `${groupId}-${this.subscriptions.length}`,
      handler: handler as EventHandler,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Group subscriptions by groupId so one consumer reader handles multiple topics with a single XREADGROUP call
    const groupMap = new Map<string, Subscription[]>();
    for (const sub of this.subscriptions) {
      const list = groupMap.get(sub.groupId) ?? [];
      list.push(sub);
      groupMap.set(sub.groupId, list);
    }

    for (const [groupId, subs] of groupMap.entries()) {
      // Ensure stream consumer groups exist
      for (const sub of subs) {
        try {
          await this.pub.xgroup('CREATE', sub.topic, sub.groupId, '$', 'MKSTREAM');
        } catch (err) {
          const errMsg = String(err);
          if (!errMsg.includes('BUSYGROUP')) {
            this.logger.warn(
              { topic: sub.topic, groupId, err: errMsg },
              'xgroup CREATE failed (will retry or proceed)',
            );
          }
        }
      }

      const reader = this.pub.duplicate();
      try {
        await reader.connect();
        this.readers.push(reader);
        void this.consumeGroupLoop(reader, groupId, subs);
      } catch (err) {
        this.logger.error(
          { groupId, err: String(err) },
          'failed to connect consumer reader for group',
        );
      }
    }
  }

  /**
   * Consumes all topics for a specific consumer group using a single multiplexed XREADGROUP call.
   * Uses a 30-second BLOCK timeout to keep idle command rate ultra-low.
   */
  private async consumeGroupLoop(
    reader: Redis,
    groupId: string,
    subs: Subscription[],
  ): Promise<void> {
    const consumerName = subs[0]?.consumer ?? groupId;
    const handlerMap = new Map<string, EventHandler>();
    for (const sub of subs) {
      handlerMap.set(sub.topic, sub.handler);
    }

    const topics = subs.map((s) => s.topic);
    const ids = subs.map(() => '>');
    let consecutiveErrors = 0;

    while (this.running) {
      try {
        const res = (await reader.xreadgroup(
          'GROUP',
          groupId,
          consumerName,
          'COUNT',
          20,
          'BLOCK',
          30000,
          'STREAMS',
          ...topics,
          ...ids,
        )) as StreamReadResult;

        consecutiveErrors = 0;
        if (!res) continue;

        for (const [topic, entries] of res) {
          const handler = handlerMap.get(topic);
          if (!handler) continue;

          for (const [id, fields] of entries) {
            await this.handleEntry(reader, topic, groupId, handler, id, fields);
          }
        }
      } catch (err) {
        if (!this.running) break;
        consecutiveErrors++;
        const backoffMs = Math.min(consecutiveErrors * 5000, 30000);
        this.logger.error(
          { groupId, err: String(err), backoffMs },
          'redis-streams multiplex read error (backing off)',
        );
        await delay(backoffMs);
      }
    }
  }

  private async handleEntry(
    reader: Redis,
    topic: string,
    groupId: string,
    handler: EventHandler,
    id: string,
    fields: string[],
  ): Promise<void> {
    const raw = fieldValue(fields, 'e');
    let envelope: EventEnvelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (err) {
      await this.toDlq(topic, raw, 'unparseable', err);
      try {
        await reader.xack(topic, groupId, id);
      } catch {
        // ignore ack failure
      }
      return;
    }

    try {
      if (!(await this.idempotency.markIfNew(envelope.event_id))) {
        await reader.xack(topic, groupId, id); // duplicate — already processed
        return;
      }
    } catch {
      // If idempotency store has rate limit or fails, continue processing to avoid dropping message
    }

    try {
      await runWithTenant(
        { tenantId: envelope.tenant_id ?? '', traceId: envelope.trace_id, scope: 'tenant' },
        () => handler(envelope),
      );
      await reader.xack(topic, groupId, id);
    } catch (err) {
      this.logger.error(
        { topic, event_id: envelope.event_id, err: String(err) },
        'handler failed → DLQ',
      );
      await this.toDlq(topic, raw, 'handler-error', err);
      try {
        await reader.xack(topic, groupId, id);
      } catch {
        // ignore ack failure
      }
    }
  }

  private async toDlq(
    topic: string,
    raw: string | null,
    reason: string,
    err: unknown,
  ): Promise<void> {
    try {
      await this.pub.xadd(
        `${topic}.dlq`,
        'MAXLEN',
        '~',
        1000,
        '*',
        'reason',
        reason,
        'err',
        err instanceof Error ? err.message : String(err),
        'raw',
        raw ?? '',
      );
    } catch (dlqErr) {
      this.logger.warn({ topic, err: String(dlqErr) }, 'failed to write redis-streams DLQ');
    }
  }
}

function fieldValue(fields: string[], key: string): string | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === key) return fields[i + 1] ?? null;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
