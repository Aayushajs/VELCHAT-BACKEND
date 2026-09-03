import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { StatusPostedPayload } from '@velchat/shared-types';
import type { StatusKind } from './status.types';

/**
 * Status events (§A11/§C11). The payload carries NO content and NO audience: personal status text
 * and caption are ciphertext, and the audience is a rule consumers resolve from the directory.
 */
export class StatusEvents {
  constructor(private readonly bus: EventBus) {}

  async statusPosted(
    statusId: string,
    userId: string,
    kind: StatusKind,
    expiresAt: string,
  ): Promise<void> {
    await this.bus.publish<StatusPostedPayload>(
      'status.posted',
      buildEnvelope({
        eventType: 'status.posted',
        key: userId,
        producer: 'content-service', // was 'presence-service' — status is content-owned (Part H)
        tenantId: null,
        // No content fields: personal status text/caption are ciphertext and must not transit the
        // bus. Consumers resolve the audience themselves via the directory.
        payload: { status_id: statusId, user_id: userId, kind, expires_at: expiresAt },
      }),
    );
  }
}
