import { uuidv7, ValidationError, ForbiddenError } from '@velchat/common';
import { ChannelsRepository } from './channels.repository';
import { ChannelsEvents } from './channels.events';
import { dmConversationId } from './dm-id';
import { MAX_GROUP_MEMBERS, type MemberRole } from './conversation.types';

/** Conversation lifecycle + membership (§B7). Emits events that drive fan-out/notify/search. */
export class ChannelsService {
  constructor(
    private readonly repo: ChannelsRepository,
    private readonly events: ChannelsEvents,
  ) {}

  /** 1:1 DM — deterministic id, created at most once (dedupe). */
  async createDm(a: string, b: string): Promise<{ conversationId: string; created: boolean }> {
    if (!a || !b || a === b) throw new ValidationError('two distinct users are required for a DM');
    const conversationId = dmConversationId(a, b);
    const created = await this.repo.createConversation({
      conversationId,
      type: 'dm',
      createdBy: a,
    });
    if (created) {
      await this.repo.addMember(conversationId, a, 'member');
      await this.repo.addMember(conversationId, b, 'member');
      await this.events.conversationCreated(conversationId, 'dm', null, a, [a, b]);
    }
    return { conversationId, created };
  }

  async createGroup(
    creator: string,
    name: string,
    memberIds: string[] = [],
  ): Promise<{ conversationId: string }> {
    const members = [...new Set([creator, ...memberIds])];
    if (members.length > MAX_GROUP_MEMBERS) {
      throw new ValidationError(`group exceeds ${MAX_GROUP_MEMBERS} members`);
    }
    const conversationId = uuidv7();
    await this.repo.createConversation({ conversationId, type: 'group', name, createdBy: creator });
    await this.repo.addMember(conversationId, creator, 'owner');
    for (const u of memberIds)
      if (u !== creator) await this.repo.addMember(conversationId, u, 'member');
    await this.events.conversationCreated(conversationId, 'group', null, creator, members);
    return { conversationId };
  }

  async createChannel(
    tenantId: string,
    creator: string,
    name: string,
    visibility = 'public',
    isAnnouncement = false,
  ): Promise<{ conversationId: string }> {
    const conversationId = uuidv7();
    await this.repo.createConversation({
      conversationId,
      type: 'channel',
      tenantId,
      name,
      visibility,
      isAnnouncement,
      createdBy: creator,
    });
    await this.repo.addMember(conversationId, creator, 'owner');
    await this.events.conversationCreated(conversationId, 'channel', tenantId, creator, [creator]);
    return { conversationId };
  }

  async addMember(
    conversationId: string,
    actorId: string,
    userId: string,
    role: MemberRole = 'member',
  ): Promise<void> {
    await this.assertAdmin(conversationId, actorId);
    if ((await this.repo.memberCount(conversationId)) >= MAX_GROUP_MEMBERS) {
      throw new ValidationError('member limit reached');
    }
    await this.repo.addMember(conversationId, userId, role);
    await this.events.memberAdded(conversationId, userId, role, null);
  }

  async removeMember(conversationId: string, actorId: string, userId: string): Promise<void> {
    await this.assertAdmin(conversationId, actorId);
    await this.repo.removeMember(conversationId, userId);
    await this.events.memberRemoved(conversationId, userId, null);
  }

  async members(conversationId: string): Promise<string[]> {
    return this.repo.listMemberUserIds(conversationId);
  }

  async markRead(conversationId: string, userId: string, seq: number): Promise<void> {
    await this.repo.updateLastRead(conversationId, userId, seq);
  }

  private async assertAdmin(conversationId: string, actorId: string): Promise<void> {
    const role = await this.repo.getMemberRole(conversationId, actorId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenError('only an owner or admin can manage members');
    }
  }
}
