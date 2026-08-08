import type { Logger } from 'pino';
import { runWithTenant, type EventEnvelope } from '@velchat/common';
import type { EventBus, EventHandler } from '../event-bus.port';

/**
 * In-memory EventBus adapter (§A11).
 * Uses Node.js EventEmitter for ₹0 single-process / monolithic deployments, testing, or offline development.
 * Automatically preserves tenant context and deduplication without requiring external Redis or Kafka.
 */
export class InMemoryEventBus implements EventBus {
  readonly name = 'event-bus:in-memory';
  private readonly subscriptions = new Map<
    string,
    Array<{ groupId: string; handler: EventHandler }>
  >();
  private readonly processedEvents = new Set<string>();
  private readonly maxProcessedHistory = 10_000;
  private running = false;

  constructor(private readonly logger: Logger) {}

  async connect(): Promise<void> {
    this.logger.info('in-memory event bus connected');
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.running = false;
    this.subscriptions.clear();
    this.processedEvents.clear();
  }

  async publish<T>(topic: string, envelope: EventEnvelope<T>): Promise<void> {
    if (!this.running) {
      this.logger.debug(
        { topic, event_id: envelope.event_id },
        'event published before bus started',
      );
    }
    // Deliver asynchronously so caller is never blocked
    setImmediate(() => {
      void this.deliver(topic, envelope);
    });
  }

  subscribe<T>(topic: string, groupId: string, handler: EventHandler<T>): void {
    const list = this.subscriptions.get(topic) ?? [];
    list.push({ groupId, handler: handler as EventHandler });
    this.subscriptions.set(topic, list);
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.info(
      { totalTopics: this.subscriptions.size },
      'in-memory event bus consumer started',
    );
  }

  private async deliver<T>(topic: string, envelope: EventEnvelope<T>): Promise<void> {
    const list = this.subscriptions.get(topic);
    if (!list || list.length === 0) return;

    // Dedupe
    if (this.processedEvents.has(envelope.event_id)) {
      return;
    }
    this.processedEvents.add(envelope.event_id);
    if (this.processedEvents.size > this.maxProcessedHistory) {
      const first = this.processedEvents.values().next().value;
      if (first) this.processedEvents.delete(first);
    }

    for (const sub of list) {
      try {
        await runWithTenant(
          { tenantId: envelope.tenant_id ?? '', traceId: envelope.trace_id, scope: 'tenant' },
          () => sub.handler(envelope),
        );
      } catch (err) {
        this.logger.error(
          { topic, event_id: envelope.event_id, groupId: sub.groupId, err: String(err) },
          'in-memory event handler error',
        );
      }
    }
  }
}
