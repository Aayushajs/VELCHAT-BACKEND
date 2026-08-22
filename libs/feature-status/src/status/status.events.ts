import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { StatusPostedPayload } from '@velchat/shared-types';
import type { StatusKind } from './status.types';

/** Status events (§A11/§C11) → realtime rings only the audience members; notification follows. */
export class StatusEvents {
  constructor(private readonly bus: EventBus) {}

  async statusPosted(
    statusId: string,
    userId: string,
    kind: StatusKind,
    audience: string[],
    expiresAt: string,
  ): Promise<void> {
    await this.bus.publish<StatusPostedPayload>(
      'status.posted',
      buildEnvelope({
        eventType: 'status.posted',
        key: userId,
        producer: 'presence-service',
        tenantId: null,
        payload: { status_id: statusId, user_id: userId, kind, audience, expires_at: expiresAt },
      }),
    );
  }
}
