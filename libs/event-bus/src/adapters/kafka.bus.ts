import { Kafka, type Producer, type Consumer, CompressionTypes, logLevel } from 'kafkajs';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import {
  parseEnvelope,
  runWithTenant,
  IdempotencyStore,
  type EventEnvelope,
} from '@velchat/shared-utils';
import type { EventBus, EventHandler } from '../event-bus.port';

export interface KafkaEventBusOptions {
  clientId: string;
  brokers: string[];
  /** Redis/Valkey URL for the dedupe store (idempotency). */
  redisUrl?: string;
}

/** Kafka event bus for the self-hosted, at-scale deployment profile (§A11). */
export class KafkaEventBus implements EventBus {
  readonly name = 'event-bus:kafka';
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly idempotency: IdempotencyStore;
  private readonly consumers: Consumer[] = [];
  private readonly subscriptions: Array<{ topic: string; groupId: string; handler: EventHandler }> =
    [];
  private connected = false;

  constructor(
    opts: KafkaEventBusOptions,
    private readonly logger: Logger,
  ) {
    this.kafka = new Kafka({
      clientId: opts.clientId,
      brokers: opts.brokers,
      logLevel: logLevel.WARN,
    });
    this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: true,
    });
    const redis = new Redis(opts.redisUrl ?? 'redis://localhost:6379', { lazyConnect: true });
    this.idempotency = new IdempotencyStore(redis, 'evt-idem');
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  async ping(): Promise<boolean> {
    return this.connected;
  }

  async close(): Promise<void> {
    for (const consumer of this.consumers) {
      try {
        await consumer.disconnect();
      } catch {
        // best effort
      }
    }
    try {
      await this.producer.disconnect();
    } catch {
      // best effort
    }
    this.connected = false;
  }

  async publish<T>(topic: string, envelope: EventEnvelope<T>): Promise<void> {
    await this.producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: envelope.key,
          value: JSON.stringify(envelope),
          headers: { event_id: envelope.event_id, tenant_id: envelope.tenant_id ?? '' },
        },
      ],
    });
  }

  subscribe<T>(topic: string, groupId: string, handler: EventHandler<T>): void {
    this.subscriptions.push({ topic, groupId, handler: handler as EventHandler });
  }

  async start(): Promise<void> {
    for (const sub of this.subscriptions) {
      const consumer = this.kafka.consumer({ groupId: sub.groupId });
      await consumer.connect();
      await consumer.subscribe({ topic: sub.topic, fromBeginning: false });
      this.consumers.push(consumer);
      await consumer.run({
        eachMessage: async ({ message }) => {
          let envelope: EventEnvelope;
          try {
            envelope = parseEnvelope(message.value);
          } catch (err) {
            this.logger.error({ topic: sub.topic, err: String(err) }, 'unparseable event dropped');
            return;
          }
          if (!(await this.idempotency.markIfNew(envelope.event_id))) return;
          await runWithTenant(
            { tenantId: envelope.tenant_id ?? '', traceId: envelope.trace_id, scope: 'tenant' },
            () => sub.handler(envelope),
          );
        },
      });
    }
  }
}
