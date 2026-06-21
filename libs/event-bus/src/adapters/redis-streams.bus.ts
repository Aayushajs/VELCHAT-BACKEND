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
 * Redis Streams event bus (Upstash free tier). XADD to publish; per-group XREADGROUP consumers
 * with XACK + dedupe + `<topic>.dlq`. Works with any Redis-compatible endpoint (Valkey locally,
 * Upstash in the cloud) — the free-tier default.
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
    this.pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.idempotency = new IdempotencyStore(this.pub, 'evt-idem');
    this.maxLen = opts?.maxLenApprox ?? 100_000;
  }

  async connect(): Promise<void> {
    await this.pub.connect();
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
      reader.disconnect();
    }
    try {
      await this.pub.quit();
    } catch {
      this.pub.disconnect();
    }
  }

  async publish<T>(topic: string, envelope: EventEnvelope<T>): Promise<void> {
    await this.pub.xadd(topic, 'MAXLEN', '~', this.maxLen, '*', 'e', JSON.stringify(envelope));
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
    for (const sub of this.subscriptions) {
      try {
        await this.pub.xgroup('CREATE', sub.topic, sub.groupId, '$', 'MKSTREAM');
      } catch (err) {
        if (!String(err).includes('BUSYGROUP')) throw err; // group already exists → fine
      }
      const reader = this.pub.duplicate();
      await reader.connect();
      this.readers.push(reader);
      void this.consumeLoop(reader, sub);
    }
  }

  private async consumeLoop(reader: Redis, sub: Subscription): Promise<void> {
    while (this.running) {
      try {
        const res = (await reader.xreadgroup(
          'GROUP',
          sub.groupId,
          sub.consumer,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          sub.topic,
          '>',
        )) as StreamReadResult;
        if (!res) continue;
        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            await this.handleEntry(reader, sub, id, fields);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error({ topic: sub.topic, err: String(err) }, 'redis-streams read error');
        await delay(1000);
      }
    }
  }

  private async handleEntry(
    reader: Redis,
    sub: Subscription,
    id: string,
    fields: string[],
  ): Promise<void> {
    const raw = fieldValue(fields, 'e');
    let envelope: EventEnvelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (err) {
      await this.toDlq(sub.topic, raw, 'unparseable', err);
      await reader.xack(sub.topic, sub.groupId, id);
      return;
    }

    if (!(await this.idempotency.markIfNew(envelope.event_id))) {
      await reader.xack(sub.topic, sub.groupId, id); // duplicate — already processed
      return;
    }

    try {
      await runWithTenant(
        { tenantId: envelope.tenant_id ?? '', traceId: envelope.trace_id, scope: 'tenant' },
        () => sub.handler(envelope),
      );
      await reader.xack(sub.topic, sub.groupId, id);
    } catch (err) {
      this.logger.error(
        { topic: sub.topic, event_id: envelope.event_id, err: String(err) },
        'handler failed → DLQ',
      );
      await this.toDlq(sub.topic, raw, 'handler-error', err);
      await reader.xack(sub.topic, sub.groupId, id);
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
        '*',
        'reason',
        reason,
        'err',
        err instanceof Error ? err.message : String(err),
        'raw',
        raw ?? '',
      );
    } catch (dlqErr) {
      this.logger.fatal({ err: String(dlqErr) }, 'failed to write redis-streams DLQ');
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
