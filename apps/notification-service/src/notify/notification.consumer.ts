import type { EventBus } from '@velchat/event-bus';
import type {
  ConversationCreatedPayload,
  ChannelMemberPayload,
  MessageSentPayload,
  CallStartedPayload,
} from '@velchat/shared-types';
import { NotificationService } from './notification.service';
import { MembersProjection } from './members.projection';

const GROUP = 'notification';

/**
 * Subscribes the events that drive notifications (§A19). Membership events keep the recipient
 * projection current; message.sent / call.started produce pushes. Registered here; the caller starts
 * the bus after wiring.
 */
export class NotificationConsumer {
  constructor(
    private readonly bus: EventBus,
    private readonly service: NotificationService,
    private readonly members: MembersProjection,
  ) {}

  register(): void {
    this.bus.subscribe<ConversationCreatedPayload>('conversation.created', GROUP, async (e) => {
      await this.members.seed(e.payload.conversation_id, e.payload.member_ids);
    });
    this.bus.subscribe<ChannelMemberPayload>('channel.member.added', GROUP, async (e) => {
      await this.members.add(e.payload.conversation_id, e.payload.user_id);
    });
    this.bus.subscribe<ChannelMemberPayload>('channel.member.removed', GROUP, async (e) => {
      await this.members.remove(e.payload.conversation_id, e.payload.user_id);
    });
    this.bus.subscribe<MessageSentPayload>('message.sent', GROUP, async (e) => {
      await this.service.onMessageSent(e.payload);
    });
    this.bus.subscribe<CallStartedPayload>('call.started', GROUP, async (e) => {
      await this.service.onCallStarted(e.payload);
    });
  }
}
