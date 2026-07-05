import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  ChannelMemberPayload,
  ChannelUpdatedPayload,
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
    meta?: { name?: string | null; visibility?: string | null },
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
          name: meta?.name ?? null,
          visibility: meta?.visibility ?? null,
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

  /** Channel metadata changed (name/topic/visibility/settings) → search + cache invalidation. */
  async channelUpdated(
    conversationId: string,
    meta?: {
      tenantId?: string | null;
      name?: string | null;
      topic?: string | null;
      visibility?: string | null;
      isAnnouncement?: boolean | null;
    },
  ): Promise<void> {
    await this.bus.publish<ChannelUpdatedPayload>(
      'channel.updated',
      buildEnvelope({
        eventType: 'channel.updated',
        key: conversationId,
        producer: 'group-channel-service',
        tenantId: meta?.tenantId ?? null,
        payload: {
          conversation_id: conversationId,
          tenant_id: meta?.tenantId ?? null,
          name: meta?.name ?? null,
          topic: meta?.topic ?? null,
          visibility: meta?.visibility ?? null,
          is_announcement: meta?.isAnnouncement ?? null,
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
