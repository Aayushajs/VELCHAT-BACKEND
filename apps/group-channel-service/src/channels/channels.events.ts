import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  ChannelMemberPayload,
  ConversationCreatedPayload,
  GroupEpochChangedPayload,
} from '@velchat/shared-types';
import type { ConversationType, MemberRole } from './conversation.types';

/** Membership events (§A11) → consumed by realtime (fan-out), notification, search, cache. */
export class ChannelsEvents {
  constructor(private readonly bus: EventBus) {}

  async conversationCreated(
    conversationId: string,
    type: ConversationType,
    tenantId: string | null,
    createdBy: string,
    memberIds: string[],
  ): Promise<void> {
    await this.bus.publish<ConversationCreatedPayload>(
      'conversation.created',
      buildEnvelope({
        eventType: 'conversation.created',
        key: conversationId,
        producer: 'group-channel-service',
        tenantId,
        payload: {
          conversation_id: conversationId,
          type,
          tenant_id: tenantId,
          created_by: createdBy,
          member_ids: memberIds,
        },
      }),
    );
  }

  async memberAdded(
    conversationId: string,
    userId: string,
    role: MemberRole,
    tenantId: string | null,
  ): Promise<void> {
    await this.bus.publish<ChannelMemberPayload>(
      'channel.member.added',
      buildEnvelope({
        eventType: 'channel.member.added',
        key: conversationId,
        producer: 'group-channel-service',
        tenantId,
        payload: { conversation_id: conversationId, user_id: userId, role, tenant_id: tenantId },
      }),
    );
  }

  async memberRemoved(
    conversationId: string,
    userId: string,
    tenantId: string | null,
  ): Promise<void> {
    await this.bus.publish<ChannelMemberPayload>(
      'channel.member.removed',
      buildEnvelope({
        eventType: 'channel.member.removed',
        key: conversationId,
        producer: 'group-channel-service',
        tenantId,
        payload: {
          conversation_id: conversationId,
          user_id: userId,
          role: 'member',
          tenant_id: tenantId,
        },
      }),
    );
  }

  /** Sender-Key epoch rotated (§G1-2) — members redistribute keys, ciphertext binds to the epoch. */
  async groupEpochChanged(
    conversationId: string,
    epoch: number,
    reason: 'member.added' | 'member.removed',
  ): Promise<void> {
    await this.bus.publish<GroupEpochChangedPayload>(
      'group.epoch.changed',
      buildEnvelope({
        eventType: 'group.epoch.changed',
        key: conversationId,
        producer: 'group-channel-service',
        tenantId: null,
        payload: {
          conversation_id: conversationId,
          epoch,
          reason,
          changed_at: new Date().toISOString(),
        },
      }),
    );
  }
}
