import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';

/**
 * Pin events (§A11) — pins are conversation-scoped, so every member should see them live. Stars,
 * archive and mute are per-user and need no fan-out, so they emit nothing.
 */
export class ExtrasEvents {
  constructor(private readonly bus: EventBus) {}

  async pinned(
    conversationId: string,
    messageId: string,
    by: string,
    pinned: boolean,
  ): Promise<void> {
    const eventType = pinned ? 'message.pinned' : 'message.unpinned';
    await this.bus.publish(
      eventType,
      buildEnvelope({
        eventType,
        key: conversationId,
        producer: 'chat-service',
        payload: { conversation_id: conversationId, message_id: messageId, by },
      }),
    );
  }
}
