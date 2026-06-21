import type { Logger } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  ChannelMemberPayload,
  ConversationCreatedPayload,
  MessageReceiptPayload,
  MessageSentPayload,
} from '@velchat/shared-types';
import type { EventRouter } from '../fabric/event-router';
import type { MembershipProjection } from './membership-projection';

const GROUP = 'realtime-fanout';

/**
 * Turns durable events into live delivery (§B9.2, completes the §B4.2 hot path). Keeps the
 * membership projection current from conversation.created / channel.member.*, and on message.sent
 * resolves the conversation's members and routes the frame to each one's online sockets.
 *
 * Personal conversations carry only ciphertext refs in the payload — the server never reads
 * plaintext; clients fetch + decrypt locally (§A14.3). Push/cursor sync is the durability backstop.
 */
export class FanoutConsumer {
  constructor(
    private readonly bus: EventBus,
    private readonly projection: MembershipProjection,
    private readonly router: EventRouter,
    private readonly logger: Logger,
  ) {}

  /** Register all subscriptions; the caller starts the bus afterwards. */
  register(): void {
    this.bus.subscribe<ConversationCreatedPayload>('conversation.created', GROUP, async (e) => {
      await this.projection.seed(e.payload.conversation_id, e.payload.member_ids);
    });
    this.bus.subscribe<ChannelMemberPayload>('channel.member.added', GROUP, async (e) => {
      await this.projection.add(e.payload.conversation_id, e.payload.user_id);
    });
    this.bus.subscribe<ChannelMemberPayload>('channel.member.removed', GROUP, async (e) => {
      await this.projection.remove(e.payload.conversation_id, e.payload.user_id);
    });
    this.bus.subscribe<MessageSentPayload>('message.sent', GROUP, async (e) => {
      await this.onMessageSent(e.payload);
    });
    // Ticks: deliver the receipt to conversation members so the sender's UI updates (§B4.4).
    this.bus.subscribe<MessageReceiptPayload>('message.delivered', GROUP, async (e) => {
      await this.onReceipt('receipt', e.payload);
    });
    this.bus.subscribe<MessageReceiptPayload>('message.read', GROUP, async (e) => {
      await this.onReceipt('receipt', e.payload);
    });
  }

  private async onReceipt(type: 'receipt', r: MessageReceiptPayload): Promise<void> {
    const members = await this.projection.members(r.conversation_id);
    if (members.length === 0) return;
    // Ephemeral frame: a coalescible UI cue, never a durable message (the receipt is stored separately).
    await this.router.route(members, { kind: 'ephemeral', type, data: r });
  }

  private async onMessageSent(m: MessageSentPayload): Promise<void> {
    const members = await this.projection.members(m.conversation_id);
    if (members.length === 0) return; // projection cold for this conversation → cursor re-sync covers it
    const frame = { kind: 'durable', type: 'message', data: m };
    const deliveries = await this.router.route(members, frame);
    this.logger.debug(
      { conversation_id: m.conversation_id, seq: m.seq, recipients: members.length, deliveries },
      'message fanned out',
    );
  }
}
