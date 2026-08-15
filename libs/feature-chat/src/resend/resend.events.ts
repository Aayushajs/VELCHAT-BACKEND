import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';

/**
 * Resend-protocol events (§G1-1). `message.resend.requested` is routed to the SENDER's devices so
 * one of them re-encrypts the current plaintext; `message.resend.fulfilled` is routed to the
 * REQUESTER's device carrying the fresh ciphertext. Both keyed by conversation_id for ordering.
 */
export class ResendEvents {
  constructor(private readonly bus: EventBus) {}

  async requested(input: {
    conversationId: string;
    messageId: string;
    senderId: string;
    requesterId: string;
    requesterDeviceId: string;
    ratchetHint: string | null;
  }): Promise<void> {
    await this.bus.publish(
      'message.resend.requested',
      buildEnvelope({
        eventType: 'message.resend.requested',
        key: input.conversationId,
        producer: 'chat-service',
        payload: {
          conversation_id: input.conversationId,
          message_id: input.messageId,
          sender_id: input.senderId,
          requester_id: input.requesterId,
          requester_device_id: input.requesterDeviceId,
          ratchet_hint: input.ratchetHint,
        },
      }),
    );
  }

  async fulfilled(input: {
    conversationId: string;
    messageId: string;
    requesterDeviceId: string;
  }): Promise<void> {
    await this.bus.publish(
      'message.resend.fulfilled',
      buildEnvelope({
        eventType: 'message.resend.fulfilled',
        key: input.conversationId,
        producer: 'chat-service',
        payload: {
          conversation_id: input.conversationId,
          message_id: input.messageId,
          requester_device_id: input.requesterDeviceId,
        },
      }),
    );
  }
}
