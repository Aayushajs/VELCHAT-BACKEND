import { v7 as uuidv7 } from 'uuid';

/**
 * Standard Kafka event envelope (§G7-3 / §G6-4).
 *
 * Every event carries `event_type`, `schema_version`, `event_id`, `occurred_at`,
 * `tenant_id`, `producer`, `trace_id`, `payload`. `event_id` powers idempotency;
 * `tenant_id` is schema-mandatory for tenant-scoped events so consumers can establish
 * tenant context before any data access. `key` is the partition key for per-entity ordering (§A11).
 */
export interface EventEnvelope<T = unknown> {
  event_type: string;
  schema_version: number;
  event_id: string;
  occurred_at: string;
  /** Schema-mandatory for tenant-scoped events; `null` only for genuinely non-tenant/system events. */
  tenant_id: string | null;
  producer: string;
  trace_id?: string;
  /** Kafka message key — entity id for ordering (§A11). */
  key: string;
  payload: T;
}

export interface BuildEnvelopeInput<T> {
  eventType: string;
  /** Partition key (entity id) — preserves per-entity ordering. */
  key: string;
  payload: T;
  producer: string;
  tenantId?: string | null;
  schemaVersion?: number;
  traceId?: string;
  /** Override only in tests; defaults to now (UTC ISO-8601). */
  occurredAt?: string;
  /** Override only in tests; defaults to a fresh UUIDv7. */
  eventId?: string;
}

export function buildEnvelope<T>(input: BuildEnvelopeInput<T>): EventEnvelope<T> {
  return {
    event_type: input.eventType,
    schema_version: input.schemaVersion ?? 1,
    event_id: input.eventId ?? uuidv7(),
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    tenant_id: input.tenantId ?? null,
    producer: input.producer,
    trace_id: input.traceId,
    key: input.key,
    payload: input.payload,
  };
}

/** Parse a raw Kafka message value into an envelope, validating the required fields. */
export function parseEnvelope<T = unknown>(raw: Buffer | string | null): EventEnvelope<T> {
  if (raw === null) {
    throw new Error('Empty Kafka message value — cannot parse envelope');
  }
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const obj = JSON.parse(text) as Partial<EventEnvelope<T>>;
  for (const field of ['event_type', 'event_id', 'occurred_at', 'producer', 'key'] as const) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new Error(`Malformed event envelope: missing "${field}"`);
    }
  }
  if (typeof obj.schema_version !== 'number') {
    throw new Error('Malformed event envelope: missing "schema_version"');
  }
  return obj as EventEnvelope<T>;
}
