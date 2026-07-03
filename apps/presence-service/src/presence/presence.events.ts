import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { PresenceChangedPayload } from '@velchat/shared-types';

/** Presence change events (§A15.2) — fanned only to the user's active subscribers, not all contacts. */
export class PresenceEvents {
  constructor(private readonly bus: EventBus) {}

  async changed(userId: string, status: 'online' | 'offline' | 'away'): Promise<void> {
    await this.bus.publish<PresenceChangedPayload>(
      'presence.changed',
      buildEnvelope({
        eventType: 'presence.changed',
        key: userId,
        producer: 'presence-service',
        tenantId: null,
        payload: { account_id: userId, status, changed_at: new Date().toISOString() },
      }),
    );
  }
}
