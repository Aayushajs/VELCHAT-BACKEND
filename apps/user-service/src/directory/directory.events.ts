import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { ContactAddedPayload } from '@velchat/shared-types';

/** Directory events (§A11) → search (personal contact index). */
export class DirectoryEvents {
  constructor(private readonly bus: EventBus) {}

  async contactAdded(userId: string, contactUserId: string): Promise<void> {
    await this.bus.publish<ContactAddedPayload>(
      'contact.added',
      buildEnvelope({
        eventType: 'contact.added',
        key: userId,
        producer: 'user-service',
        tenantId: null,
        payload: {
          user_id: userId,
          contact_user_id: contactUserId,
          added_at: new Date().toISOString(),
        },
      }),
    );
  }
}
