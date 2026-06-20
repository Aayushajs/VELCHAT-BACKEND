import { buildEnvelope, EventPublisher, type EventEnvelope } from '@velchat/shared-utils';
import type { UserCreatedPayload } from '@velchat/shared-types';

/**
 * Reference: build a `user.created` event using the standard envelope (§G7). Carries
 * `tenant_id` so downstream consumers can establish tenant context before any access (§G6-4).
 * (Full auth flows land in P1 / §B2; this exists so BOOT-0 demonstrates the event contract.)
 */
export function buildUserCreatedEvent(input: {
  accountId: string;
  tenantId: string | null;
  traceId?: string;
}): EventEnvelope<UserCreatedPayload> {
  return buildEnvelope<UserCreatedPayload>({
    eventType: 'user.created',
    key: input.accountId, // partition by account_id for per-entity ordering (§A11)
    producer: 'auth-service',
    tenantId: input.tenantId,
    traceId: input.traceId,
    payload: {
      account_id: input.accountId,
      tenant_id: input.tenantId,
      created_at: new Date().toISOString(),
    },
  });
}

/** Publish the sample event to Kafka via the idempotent producer. */
export async function emitUserCreated(
  publisher: EventPublisher,
  input: { accountId: string; tenantId: string | null },
): Promise<EventEnvelope<UserCreatedPayload>> {
  const envelope = buildUserCreatedEvent(input);
  await publisher.publish('user.created', envelope);
  return envelope;
}
