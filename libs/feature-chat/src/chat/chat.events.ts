import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  MessageSentPayload,
  MessageReactionPayload,
  MessageEditedPayload,
  MessageDeletedPayload,
} from '@velchat/shared-types';
import type { MessageDoc } from './message.types';

/** message.* events (§A11). Keyed by conversation_id so per-conversation order is preserved. */
export class ChatEvents {
  constructor(private readonly bus: EventBus) {}

  /**
   * Emit message.sent. `tenantId` set ⇒ server-readable (enterprise/channel); `text` is the plaintext
   * body carried ONLY in that case so search can index it. For personal E2EE both are omitted — the
   * server holds only ciphertext and must never index/route on plaintext (§A14.3 / §A18.2).
   */
  async messageSent(m: MessageDoc, tenantId: string | null = null, text?: string): Promise<void> {
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
          client_msg_id: m.client_msg_id,
          type: m.type,
          content: m.content,
          reply_to: m.reply_to,
          mentions: m.mentions as Array<{ user_id: string; type: string }>,
          sender_account_id: m.sender_id,
          sent_at: m.server_ts,
          ...(text !== undefined ? { text } : {}),
        },
      }),
    );
  }

  /** Emit message.reaction.added / message.reaction.removed (§A11/§B15) for live fan-out. */
  async reaction(
    added: boolean,
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    const eventType = added ? 'message.reaction.added' : 'message.reaction.removed';
    await this.bus.publish<MessageReactionPayload>(
      eventType,
      buildEnvelope({
        eventType,
        key: conversationId,
        producer: 'chat-service',
        payload: {
          conversation_id: conversationId,
          message_id: messageId,
          user_id: userId,
          emoji,
        },
      }),
    );
  }

  /**
   * Emit message.edited (§B15). `text` (the new plaintext body) is carried ONLY when server-readable
   * (enterprise/channel) so search can re-index; personal E2EE edits stay opaque (§A18.2).
   */
  async edited(m: MessageDoc, tenantId: string | null = null, text?: string): Promise<void> {
    await this.bus.publish<MessageEditedPayload>(
      'message.edited',
      buildEnvelope({
        eventType: 'message.edited',
        key: m.conversation_id,
        producer: 'chat-service',
        tenantId,
        payload: {
          conversation_id: m.conversation_id,
          message_id: m._id,
          seq: m.seq,
          edited_at: m.edited_at ?? m.server_ts,
          ...(text !== undefined ? { text } : {}),
        },
      }),
    );
  }

  /** Emit message.deleted (§B15) — the tombstone fan-out; realtime clears it and search purges it. */
  async deleted(
    conversationId: string,
    messageId: string,
    seq: number,
    tenantId: string | null = null,
  ): Promise<void> {
    await this.bus.publish<MessageDeletedPayload>(
      'message.deleted',
      buildEnvelope({
        eventType: 'message.deleted',
        key: conversationId,
        producer: 'chat-service',
        tenantId,
        payload: { conversation_id: conversationId, message_id: messageId, seq },
      }),
    );
  }
}
