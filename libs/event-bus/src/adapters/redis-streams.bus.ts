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
  handler: EventHandler;
}

/** One reader per consumer GROUP, multiplexed across every topic that group subscribes to. */
interface ConsumerGroup {
  groupId: string;
  consumer: string;
  topics: string[];
  handlers: Map<string, EventHandler>;
  reader: Redis;
  loop?: Promise<void>;
}

type StreamReadResult = Array<[string, Array<[string, string[]]>]> | null;

/** Attempts per entry before it is treated as poison and moved to the DLQ. */
const MAX_HANDLER_ATTEMPTS = 3;
/** An entry pending longer than this is considered abandoned and is reclaimed. */
const RECLAIM_MIN_IDLE_MS = 60_000;
/** How often to sweep for abandoned entries. */
const RECLAIM_INTERVAL_MS = 30_000;

/**
 * Redis Streams event bus. XADD to publish; per-group XREADGROUP consumers with XACK, dedupe,
 * bounded retry, an XAUTOCLAIM reclaim sweep, and a `<topic>.dlq` for poison entries. Works against
 * any Redis-compatible endpoint (local Valkey, or a managed one).
 *
 * Four properties here are load-bearing, and each replaces a defect the audit found:
 *
 * 1. **Idempotency is marked AFTER the handler succeeds.** Marking first meant a process killed
 *    mid-handling recorded the event as processed, so the redelivery skipped it — silent event loss.
 * 2. **A failing handler is retried before the DLQ.** Diverting on the first error meant one
 *    transient Mongo blip permanently dropped a message fan-out.
 * 3. **Abandoned entries are reclaimed.** Without XAUTOCLAIM, an entry delivered but never
 *    acknowledged (the crash-before-XACK case) sat in the pending list forever and nobody processed
 *    it again.
 * 4. **One reader per consumer group, not per subscription.** 23 subscriptions each with their own
 *    connection and blocking read cost ~397,000 commands/day at idle. Multiplexing the topics of a
 *    group into a single XREADGROUP makes the idle cost negligible and cuts 23 connections to 4.
 */
export class RedisStreamsEventBus implements EventBus {
  readonly name = 'event-bus:redis-streams';
  private readonly pub: Redis;
  private readonly idempotency: IdempotencyStore;
  private readonly subscriptions: Subscription[] = [];
  private readonly groups: ConsumerGroup[] = [];
  private readonly maxLen: number;
  private readonly blockMs: number;
  private reclaimTimer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    url: string,
    private readonly logger: Logger,
    opts?: { maxLenApprox?: number; blockMs?: number },
  ) {
    this.pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.idempotency = new IdempotencyStore(this.pub, 'evt-idem');
    this.maxLen = opts?.maxLenApprox ?? 100_000;
    // A long block means a near-zero idle command rate. Configurable because a proxied endpoint may
    // close a connection that blocks too long.
    this.blockMs = opts?.blockMs ?? Number(process.env.EVENT_BUS_BLOCK_MS ?? 30_000);
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
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    // Wait for the loops to notice. Detaching without waiting leaves a handler mid-flight and, in
    // tests, an open handle that stops the process from exiting.
    for (const g of this.groups) {
      g.reader.disconnect();
      await g.loop?.catch(() => undefined);
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
    this.subscriptions.push({ topic, groupId, handler: handler as EventHandler });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Group the subscriptions so each consumer group reads all of its topics in ONE call.
    const byGroup = new Map<string, Subscription[]>();
    for (const sub of this.subscriptions) {
      const list = byGroup.get(sub.groupId) ?? [];
      list.push(sub);
      byGroup.set(sub.groupId, list);
    }

    for (const [groupId, subs] of byGroup) {
      const topics = [...new Set(subs.map((s) => s.topic))];
      for (const topic of topics) {
        try {
          await this.pub.xgroup('CREATE', topic, groupId, '$', 'MKSTREAM');
        } catch (err) {
          if (!String(err).includes('BUSYGROUP')) throw err; // already exists → fine
        }
      }
      const reader = this.pub.duplicate();
      await reader.connect();
      const group: ConsumerGroup = {
        groupId,
        // Stable per process, so a restart's abandoned entries are visibly someone else's and get
        // reclaimed rather than silently re-owned.
        consumer: `${groupId}-${process.pid}`,
        topics,
        handlers: new Map(subs.map((s) => [s.topic, s.handler])),
        reader,
      };
      this.groups.push(group);
      group.loop = this.consumeLoop(group);
    }

    this.reclaimTimer = setInterval(() => void this.reclaimAbandoned(), RECLAIM_INTERVAL_MS);
    // Sweep once shortly after start so a previous process's stranded entries are not left waiting
    // a full interval.
    setTimeout(() => void this.reclaimAbandoned(), 1_000).unref?.();
  }

  private async consumeLoop(group: ConsumerGroup): Promise<void> {
    while (this.running) {
      try {
        const res = (await group.reader.xreadgroup(
          'GROUP',
          group.groupId,
          group.consumer,
          'COUNT',
          10,
          'BLOCK',
          this.blockMs,
          'STREAMS',
          ...group.topics,
          ...group.topics.map(() => '>'),
        )) as StreamReadResult;
        if (!res) continue;
        for (const [topic, entries] of res) {
          for (const [id, fields] of entries) {
            await this.handleEntry(group, topic, id, fields);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error({ group: group.groupId, err: String(err) }, 'redis-streams read error');
        await delay(1000);
      }
    }
  }

  /**
   * Hand any entry that has been pending too long to this consumer. This is the crash-recovery path:
   * an entry read but never acknowledged is otherwise stranded in the pending list permanently.
   */
  private async reclaimAbandoned(): Promise<void> {
    if (!this.running) return;
    for (const group of this.groups) {
      for (const topic of group.topics) {
        try {
          const res = (await group.reader.xautoclaim(
            topic,
            group.groupId,
            group.consumer,
            RECLAIM_MIN_IDLE_MS,
            '0-0',
            'COUNT',
            10,
          )) as [string, Array<[string, string[]]>] | null;
          for (const [id, fields] of res?.[1] ?? []) {
            this.logger.warn({ topic, id }, 'reclaimed abandoned event');
            await this.handleEntry(group, topic, id, fields);
          }
        } catch (err) {
          this.logger.debug({ topic, err: String(err) }, 'reclaim sweep skipped');
        }
      }
    }
  }

  private async handleEntry(
    group: ConsumerGroup,
    topic: string,
    id: string,
    fields: string[],
  ): Promise<void> {
    const raw = fieldValue(fields, 'e');
    let envelope: EventEnvelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (err) {
      // Retrying a malformed payload can never succeed, so it goes straight out.
      await this.toDlq(topic, raw, 'unparseable', err);
      await this.ack(group, topic, id);
      return;
    }

    if (await this.idempotency.wasProcessed(envelope.event_id)) {
      await this.ack(group, topic, id);
      return;
    }

    const handler = group.handlers.get(topic);
    if (!handler) {
      await this.ack(group, topic, id);
      return;
    }

    for (let attempt = 1; attempt <= MAX_HANDLER_ATTEMPTS; attempt += 1) {
      try {
        await runWithTenant(
          { tenantId: envelope.tenant_id ?? '', traceId: envelope.trace_id, scope: 'tenant' },
          () => handler(envelope),
        );
        // AFTER success, never before: marking first turns a crash mid-handling into a lost event.
        await this.idempotency.markIfNew(envelope.event_id);
        await this.ack(group, topic, id);
        return;
      } catch (err) {
        if (attempt < MAX_HANDLER_ATTEMPTS) {
          this.logger.warn(
            { topic, event_id: envelope.event_id, attempt, err: String(err) },
            'handler failed, retrying',
          );
          await delay(50 * attempt); // brief, increasing backoff
          continue;
        }
        this.logger.error(
          { topic, event_id: envelope.event_id, attempts: attempt, err: String(err) },
          'handler failed after retries → DLQ',
        );
        await this.toDlq(topic, raw, 'handler-error', err);
        await this.ack(group, topic, id);
      }
    }
  }

  /** Acknowledge, tolerating failure: an unacknowledged entry is reclaimed later, not lost. */
  private async ack(group: ConsumerGroup, topic: string, id: string): Promise<void> {
    try {
      await group.reader.xack(topic, group.groupId, id);
    } catch (err) {
      this.logger.warn({ topic, id, err: String(err) }, 'xack failed — entry will be reclaimed');
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
