import { Kafka, type Producer, type KafkaConfig, CompressionTypes, logLevel } from 'kafkajs';
import type { EventEnvelope } from './event-envelope';

export function createKafka(opts: { clientId: string; brokers: string[] }): Kafka {
  const config: KafkaConfig = {
    clientId: opts.clientId,
    brokers: opts.brokers,
    logLevel: logLevel.WARN,
    retry: { retries: 8, initialRetryTime: 300 },
  };
  return new Kafka(config);
}

/**
 * Publishes events wrapped in the standard envelope (§G7). Uses an idempotent producer
 * (acks=all, dedup) so producer retries don't duplicate, and sets the Kafka message key
 * from the envelope key for per-entity ordering (§A11).
 */
export class EventPublisher {
  private readonly producer: Producer;
  private connected = false;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: true,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
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
          headers: {
            event_id: envelope.event_id,
            event_type: envelope.event_type,
            schema_version: String(envelope.schema_version),
            tenant_id: envelope.tenant_id ?? '',
          },
        },
      ],
    });
  }
}
