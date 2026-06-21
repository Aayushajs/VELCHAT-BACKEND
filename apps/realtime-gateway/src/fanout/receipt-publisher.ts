import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { MessageReceiptPayload } from '@velchat/shared-types';

/**
 * Inbound receipt signals from a socket (§B9.3). WsFabric stays transport-only and forwards
 * delivered/read acks here; the implementation turns them into durable events. A read/delivered
 * receipt is compact — `upToSeq` covers every message at or below it (§B4.4).
 */
export interface InboundSink {
  delivered(userId: string, conversationId: string, upToSeq: number): Promise<void>;
  read(userId: string, conversationId: string, upToSeq: number): Promise<void>;
}

/** Publishes message.delivered / message.read (keyed by conversation_id for per-conv order). */
export class ReceiptPublisher implements InboundSink {
  constructor(private readonly bus: EventBus) {}

  delivered(userId: string, conversationId: string, upToSeq: number): Promise<void> {
    return this.emit('message.delivered', 'delivered', userId, conversationId, upToSeq);
  }

  read(userId: string, conversationId: string, upToSeq: number): Promise<void> {
    return this.emit('message.read', 'read', userId, conversationId, upToSeq);
  }

  private async emit(
    topic: 'message.delivered' | 'message.read',
    state: 'delivered' | 'read',
    userId: string,
    conversationId: string,
    upToSeq: number,
  ): Promise<void> {
    await this.bus.publish<MessageReceiptPayload>(
      topic,
      buildEnvelope({
        eventType: topic,
        key: conversationId,
        producer: 'realtime-gateway',
        payload: {
          conversation_id: conversationId,
          up_to_seq: upToSeq,
          user_id: userId,
          state,
          at: new Date().toISOString(),
        },
      }),
    );
  }
}
