import type { EventEnvelope, ManagedResource } from '@velchat/shared-utils';

export type EventHandler<T = unknown> = (envelope: EventEnvelope<T>) => Promise<void>;

/**
 * Provider-agnostic event bus (§A11). One interface, two adapters:
 *  - RedisStreamsEventBus — Upstash free tier (₹0 MVP default)
 *  - KafkaEventBus        — self-hosted Kafka at scale
 *
 * Both: standard envelope (§G7), at-most-once side effects via `event_id` dedupe (§A11),
 * tenant context established from the envelope before the handler runs (§G6-4), and a
 * `<topic>.dlq` for poison messages. Extends ManagedResource so InfraLifecycle owns its
 * connect/ping/close.
 */
export interface EventBus extends ManagedResource {
  publish<T>(topic: string, envelope: EventEnvelope<T>): Promise<void>;
  /** Register a durable consumer group. Register all subscriptions, then call start(). */
  subscribe<T>(topic: string, groupId: string, handler: EventHandler<T>): void;
  /** Begin consuming every registered subscription (call after onApplicationBootstrap). */
  start(): Promise<void>;
}
