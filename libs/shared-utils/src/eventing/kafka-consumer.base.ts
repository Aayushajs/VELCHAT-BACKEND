import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import type { Logger } from 'pino';
import { EventPublisher } from './kafka-client';
import { IdempotencyStore } from './idempotency';
import { parseEnvelope, type EventEnvelope } from './event-envelope';
import { runWithTenant } from '../tenant/tenant-context';

export interface ConsumerDeps {
  kafka: Kafka;
  idempotency: IdempotencyStore;
  publisher: EventPublisher;
  logger: Logger;
}

/**
 * Base class for Kafka consumers. Enforces the cross-cutting reliability + isolation rules
 * so individual consumers only implement `handle()`:
 *
 *  - parses the standard envelope (§G7);
 *  - §G6-4: establishes tenant context from `tenant_id` BEFORE any data access; a
 *    tenant-scoped event missing a tenant goes to the DLQ (fail-closed, never processed unscoped);
 *  - §A11: dedupes by `event_id` (at-most-once side effects);
 *  - routes poison messages to `<topic>.dlq` with an alertable log, then commits so the
 *    group is not blocked.
 */
export abstract class BaseEventConsumer<T = unknown> {
  protected abstract readonly topic: string;
  protected abstract readonly groupId: string;
  /** Set false only for genuinely non-tenant topics (e.g. global directory events). */
  protected readonly requireTenantId: boolean = true;

  private consumer?: Consumer;

  constructor(protected readonly deps: ConsumerDeps) {}

  protected abstract handle(envelope: EventEnvelope<T>): Promise<void>;

  get dlqTopic(): string {
    return `${this.topic}.dlq`;
  }

  async start(): Promise<void> {
    const consumer = this.deps.kafka.consumer({ groupId: this.groupId });
    this.consumer = consumer;
    await consumer.connect();
    await consumer.subscribe({ topic: this.topic, fromBeginning: false });
    await consumer.run({ eachMessage: (payload) => this.onMessage(payload) });
    this.deps.logger.info({ topic: this.topic, groupId: this.groupId }, 'consumer started');
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async onMessage({ message }: EachMessagePayload): Promise<void> {
    let envelope: EventEnvelope<T>;
    try {
      envelope = parseEnvelope<T>(message.value);
    } catch (err) {
      await this.toDlq(message.value, 'unparseable', err);
      return;
    }

    if (this.requireTenantId && !envelope.tenant_id) {
      // §G6-4: never process a tenant-scoped event without a tenant. Fail closed → DLQ.
      await this.toDlq(message.value, 'missing-tenant', new Error('tenant_id absent'));
      return;
    }

    const fresh = await this.deps.idempotency.markIfNew(envelope.event_id);
    if (!fresh) {
      this.deps.logger.debug({ event_id: envelope.event_id }, 'duplicate event ignored');
      return;
    }

    const ctx = {
      tenantId: envelope.tenant_id ?? '',
      traceId: envelope.trace_id,
      scope: 'tenant' as const,
    };

    try {
      await runWithTenant(ctx, () => this.handle(envelope));
    } catch (err) {
      this.deps.logger.error(
        { event_id: envelope.event_id, topic: this.topic, err: errMsg(err) },
        'event handler failed → DLQ',
      );
      await this.toDlq(message.value, 'handler-error', err);
    }
  }

  private async toDlq(value: Buffer | null, reason: string, err: unknown): Promise<void> {
    this.deps.logger.error(
      { topic: this.topic, reason, err: errMsg(err) },
      'routing message to DLQ',
    );
    try {
      await this.deps.publisher.publish(this.dlqTopic, {
        event_type: `${this.topic}.dlq`,
        schema_version: 1,
        event_id: `dlq-${Date.now()}`,
        occurred_at: new Date().toISOString(),
        tenant_id: null,
        producer: this.groupId,
        key: reason,
        payload: { reason, raw: value ? value.toString('utf8') : null },
      });
    } catch (dlqErr) {
      this.deps.logger.fatal({ err: errMsg(dlqErr) }, 'failed to write to DLQ');
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
