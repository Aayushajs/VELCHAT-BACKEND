import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { MessageReceiptPayload } from '@velchat/shared-types';
import type { MembershipProjection } from './membership-projection';

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
  constructor(
    private readonly bus: EventBus,
    private readonly projection?: MembershipProjection,
  ) {}

  async delivered(userId: string, conversationId: string, upToSeq: number): Promise<void> {
    if (!(await this.mayPublish(userId, conversationId))) return;
    return this.emit('message.delivered', 'delivered', userId, conversationId, upToSeq);
  }

  async read(userId: string, conversationId: string, upToSeq: number): Promise<void> {
    if (!(await this.mayPublish(userId, conversationId))) return;
    return this.emit('message.read', 'read', userId, conversationId, upToSeq);
  }

  /**
   * Second line of defence behind WsFabric's membership gate. It fails CLOSED — an empty member
   * list means "cannot confirm", not "allow".
   *
   * That distinction matters: this check previously read `members.length > 0 && !includes(userId)`,
   * so a cold projection skipped it entirely and published the receipt. Cold was the COMMON case,
   * because the projection's HTTP fallback was unauthenticated and always returned `[]` (DEF-14).
   * A layer that opens exactly when the primary one is struggling is not a layer.
   */
  private async mayPublish(userId: string, conversationId: string): Promise<boolean> {
    if (!this.projection) return true; // no projection wired: the fabric gate is the only gate
    try {
      const members = await this.projection.members(conversationId);
      return members.includes(userId);
    } catch {
      return false;
    }
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
