import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { MessageSentPayload } from '@velchat/shared-types';
import type { MessageDoc } from './message.types';

/** message.* events (§A11). Keyed by conversation_id so per-conversation order is preserved. */
export class ChatEvents {
  constructor(private readonly bus: EventBus) {}

  async messageSent(m: MessageDoc, tenantId: string | null = null): Promise<void> {
    await this.bus.publish<MessageSentPayload>(
      'message.sent',
      buildEnvelope({
        eventType: 'message.sent',
        key: m.conversation_id,
        producer: 'chat-service',
        tenantId,
        payload: {
          conversation_id: m.conversation_id,
          message_id: m._id,
          seq: m.seq,
          sender_account_id: m.sender_id,
          sent_at: m.server_ts,
        },
      }),
    );
  }
}
