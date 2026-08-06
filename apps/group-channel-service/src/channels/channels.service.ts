import { uuidv7, ValidationError, ForbiddenError, NotFoundError } from '@velchat/common';
import { ChannelsRepository } from './channels.repository';
import { ChannelsEvents } from './channels.events';
import { dmConversationId } from './dm-id';
import { MAX_GROUP_MEMBERS, type MemberRole } from './conversation.types';

/** Role rank: higher number = higher privilege. Used for role-rank enforcement. */
const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 };

/** Conversation lifecycle + membership (§B7). Emits events that drive fan-out/notify/search. */
export class ChannelsService {
  constructor(
    private readonly repo: ChannelsRepository,
    private readonly events: ChannelsEvents,
  ) {}

  /** 1:1 DM — deterministic id, created at most once (dedupe). `a === b` is a self-chat
   * ("Message yourself", WhatsApp-style): a single-member DM keyed by the same deterministic id. */
  async createDm(a: string, b: string): Promise<{ conversationId: string; created: boolean }> {
    if (!a || !b) throw new ValidationError('two user ids are required for a DM');
    const self = a === b;
    const conversationId = dmConversationId(a, b);
    const created = await this.repo.createConversation({
      conversationId,
      type: 'dm',
      createdBy: a,
    });
    if (created) {
      await this.repo.addMember(conversationId, a, 'member');
      if (!self) await this.repo.addMember(conversationId, b, 'member');
      await this.events.conversationCreated(conversationId, 'dm', null, a, self ? [a] : [a, b]);
    }
    return { conversationId, created };
  }

  /**
   * §B7 group creation. Creator = owner. Members inserted in a SINGLE batch query (§perf).
   */
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

    // Batch insert: owner first, then members — single INSERT query (§perf: was N+1).
    const batch = [
      { userId: creator, role: 'owner' as MemberRole },
      ...memberIds
        .filter((u) => u !== creator)
        .map((u) => ({ userId: u, role: 'member' as MemberRole })),
    ];
    await this.repo.addMembersBatch(conversationId, batch);

    await this.events.conversationCreated(conversationId, 'group', null, creator, members, {
      name,
    });
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
    await this.events.conversationCreated(conversationId, 'channel', tenantId, creator, [creator], {
      name,
      visibility,
    });
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
    await this.rotateEpoch(conversationId, 'member.added');
  }

  /**
   * Remove a member — with LAST-OWNER PROTECTION (§D4 audit fix #3):
   * cannot remove the last owner of a group/channel.
   */
  async removeMember(conversationId: string, actorId: string, userId: string): Promise<void> {
    await this.assertAdmin(conversationId, actorId);

    // Last-owner protection: if the target is an owner, check that at least 2 owners exist.
    const targetRole = await this.repo.getMemberRole(conversationId, userId);
    if (targetRole === 'owner') {
      const ownerCount = await this.repo.countByRole(conversationId, 'owner');
      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot remove the last owner — transfer ownership first');
      }
    }

    await this.repo.removeMember(conversationId, userId);
    await this.events.memberRemoved(conversationId, userId, null);
    await this.rotateEpoch(conversationId, 'member.removed');
  }

  /** Rotate the Sender-Key epoch on a group membership change (§G1-2); no-op for non-groups. */
  private async rotateEpoch(
    conversationId: string,
    reason: 'member.added' | 'member.removed',
  ): Promise<void> {
    const epoch = await this.repo.bumpSenderKeyEpochIfGroup(conversationId);
    if (epoch !== null) await this.events.groupEpochChanged(conversationId, epoch, reason);
  }

  async members(conversationId: string): Promise<string[]> {
    return this.repo.listMemberUserIds(conversationId);
  }

  async markRead(conversationId: string, userId: string, seq: number): Promise<void> {
    await this.repo.updateLastRead(conversationId, userId, seq);
  }

  /** The inbox: every conversation the user belongs to (§M0 — lets a fresh install re-discover
   * its DMs/groups; the client backfills messages per conversation via chat-service afterSeq). */
  listUserConversations(userId: string): Promise<Array<Record<string, unknown>>> {
    if (!userId) throw new ValidationError('userId is required');
    return this.repo.listConversationsForUser(userId);
  }

  /**
   * Assert actor is an owner or admin (§B7 membership ACL).
   * Role hierarchy: owner > admin > member.
   */
  private async assertAdmin(conversationId: string, actorId: string): Promise<void> {
    const role = await this.repo.getMemberRole(conversationId, actorId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenError('only an owner or admin can manage members');
    }
  }

  // ── details + channel discovery/update (§B7) ──
  async getConversation(conversationId: string): Promise<Record<string, unknown>> {
    const c = await this.repo.getConversation(conversationId);
    if (!c) throw new NotFoundError('conversation not found');
    return c;
  }

  listChannels(tenantId: string, onlyPublic = true): Promise<Array<Record<string, unknown>>> {
    if (!tenantId) throw new ValidationError('tenantId is required');
    return this.repo.listChannels(tenantId, onlyPublic);
  }

  async updateChannel(
    conversationId: string,
    actorId: string,
    patch: {
      name?: string;
      topic?: string;
      avatarMediaId?: string;
      visibility?: string;
      isAnnouncement?: boolean;
      settings?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    await this.assertAdmin(conversationId, actorId);
    const updated = await this.repo.updateConversation(conversationId, patch);
    if (!updated) throw new NotFoundError('conversation not found');
    await this.events.channelUpdated(conversationId, {
      tenantId: (updated.tenant_id as string) ?? null,
      name: (updated.name as string) ?? null,
      topic: (updated.topic as string) ?? null,
      visibility: (updated.visibility as string) ?? null,
      isAnnouncement: (updated.is_announcement as boolean) ?? null,
    });
    return updated;
  }

  /** Self-service join of a PUBLIC channel. Private channels require an admin invite (addMember). */
  async joinChannel(conversationId: string, userId: string): Promise<{ message: string }> {
    const c = await this.repo.getConversation(conversationId);
    if (!c) throw new NotFoundError('channel not found');
    if (c.type !== 'channel') throw new ValidationError('can only self-join channels');
    if (c.visibility !== 'public') throw new ForbiddenError('this channel is invite-only');
    await this.repo.addMember(conversationId, userId, 'member');
    await this.events.memberAdded(
      conversationId,
      userId,
      'member',
      (c.tenant_id as string) ?? null,
    );
    return { message: 'Joined channel.' };
  }

  /**
   * Leave a channel — with LAST-OWNER PROTECTION (§D4 audit fix #3):
   * the last owner cannot leave without transferring ownership first.
   */
  async leaveChannel(conversationId: string, userId: string): Promise<{ message: string }> {
    const role = await this.repo.getMemberRole(conversationId, userId);
    if (role === 'owner') {
      const ownerCount = await this.repo.countByRole(conversationId, 'owner');
      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot leave as the last owner — transfer ownership first');
      }
    }
    await this.repo.removeMember(conversationId, userId);
    await this.events.memberRemoved(conversationId, userId, null);
    return { message: 'Left channel.' };
  }

  /**
   * Set a member's role — with LAST-OWNER PROTECTION and ROLE-RANK checks (§D4 audit fix #2 + #3):
   * 1. Cannot demote the last owner.
   * 2. Only an owner can promote to owner.
   * 3. An admin cannot change another admin's or owner's role.
   */
  async setMemberRole(
    conversationId: string,
    actorId: string,
    userId: string,
    role: MemberRole,
  ): Promise<{ message: string }> {
    // Get actor's role for rank checks.
    const actorRole = await this.repo.getMemberRole(conversationId, actorId);
    if (!actorRole || ROLE_RANK[actorRole] < ROLE_RANK['admin']) {
      throw new ForbiddenError('only an owner or admin can manage roles');
    }

    // Rank check: actor can only set roles BELOW their own rank (except owners, who can do anything).
    if (actorRole !== 'owner' && ROLE_RANK[role] >= ROLE_RANK[actorRole]) {
      throw new ForbiddenError('cannot assign a role equal to or above your own');
    }

    // Only owners can promote to owner.
    if (role === 'owner' && actorRole !== 'owner') {
      throw new ForbiddenError('only an owner can promote to owner');
    }

    // Last-owner protection: if demoting FROM owner → check owner count ≥ 2.
    const targetRole = await this.repo.getMemberRole(conversationId, userId);
    if (targetRole === 'owner' && role !== 'owner') {
      const ownerCount = await this.repo.countByRole(conversationId, 'owner');
      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot demote the last owner — promote another member first');
      }
    }

    // Rank check: actor cannot change the role of someone with equal or higher rank (unless owner).
    if (targetRole && actorRole !== 'owner' && ROLE_RANK[targetRole] >= ROLE_RANK[actorRole]) {
      throw new ForbiddenError('cannot change the role of a member with equal or higher rank');
    }

    await this.repo.setMemberRole(conversationId, userId, role);
    return { message: `Role updated to ${role}.` };
  }

  /** A member sets their OWN per-conversation notification level (all|mentions|none). */
  async setNotifLevel(
    conversationId: string,
    userId: string,
    level: string,
  ): Promise<{ message: string }> {
    await this.repo.setNotifLevel(conversationId, userId, level);
    return { message: `Notifications set to ${level}.` };
  }

  // ── communities (group-of-groups + announcement channel, §B7) ──
  async createCommunity(
    name: string,
    creator: string,
    orgId?: string,
  ): Promise<{ communityId: string; announcementChannelId: string }> {
    if (!name) throw new ValidationError('name is required');
    const communityId = uuidv7();
    // Every community gets a read-only announcement channel.
    const announcementChannelId = uuidv7();
    await this.repo.createConversation({
      conversationId: announcementChannelId,
      type: 'channel',
      tenantId: orgId ?? null,
      name: `${name} — Announcements`,
      visibility: 'public',
      isAnnouncement: true,
      createdBy: creator,
    });
    await this.repo.addMember(announcementChannelId, creator, 'owner');
    await this.repo.attachChannelToCommunity(announcementChannelId, communityId);
    await this.repo.createCommunity(communityId, name, orgId ?? null, announcementChannelId);
    return { communityId, announcementChannelId };
  }

  async addChannelToCommunity(
    communityId: string,
    conversationId: string,
    actorId: string,
  ): Promise<{ message: string }> {
    if (!(await this.repo.getCommunity(communityId)))
      throw new NotFoundError('community not found');
    await this.assertAdmin(conversationId, actorId);
    await this.repo.attachChannelToCommunity(conversationId, communityId);
    return { message: 'Channel added to community.' };
  }

  listCommunityChannels(communityId: string): Promise<Array<Record<string, unknown>>> {
    return this.repo.listCommunityChannels(communityId);
  }
}
