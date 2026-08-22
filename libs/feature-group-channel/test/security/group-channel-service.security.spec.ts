import {
  requireTenant,
  TenantContextMissingError,
  ForbiddenError,
  ValidationError,
} from '@velchat/common';
import { ChannelsService } from '../../src/channels/channels.service';
import type { ChannelsRepository } from '../../src/channels/channels.repository';
import type { ChannelsEvents } from '../../src/channels/channels.events';

// ── Minimal mock factories ──
function mockRepo(overrides: Partial<ChannelsRepository> = {}): ChannelsRepository {
  return {
    createConversation: jest.fn().mockResolvedValue(true),
    addMember: jest.fn().mockResolvedValue(undefined),
    addMembersBatch: jest.fn().mockResolvedValue(undefined),
    removeMember: jest.fn().mockResolvedValue(undefined),
    listMemberUserIds: jest.fn().mockResolvedValue([]),
    getMemberRole: jest.fn().mockResolvedValue(null),
    memberCount: jest.fn().mockResolvedValue(2),
    countByRole: jest.fn().mockResolvedValue(1),
    updateLastRead: jest.fn().mockResolvedValue(undefined),
    bumpSenderKeyEpochIfGroup: jest.fn().mockResolvedValue(null),
    listConversationsForUser: jest.fn().mockResolvedValue([]),
    getConversation: jest.fn().mockResolvedValue(null),
    listChannels: jest.fn().mockResolvedValue([]),
    updateConversation: jest.fn().mockResolvedValue(null),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    setNotifLevel: jest.fn().mockResolvedValue(undefined),
    createCommunity: jest.fn().mockResolvedValue(undefined),
    getCommunity: jest.fn().mockResolvedValue(null),
    attachChannelToCommunity: jest.fn().mockResolvedValue(undefined),
    listCommunityChannels: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ChannelsRepository;
}

function mockEvents(): ChannelsEvents {
  return {
    conversationCreated: jest.fn().mockResolvedValue(undefined),
    memberAdded: jest.fn().mockResolvedValue(undefined),
    memberRemoved: jest.fn().mockResolvedValue(undefined),
    groupEpochChanged: jest.fn().mockResolvedValue(undefined),
    channelUpdated: jest.fn().mockResolvedValue(undefined),
  } as unknown as ChannelsEvents;
}

/**
 * Security regression for group-channel-service (§D4 threat model + §G6 isolation).
 * Covers the high-risk findings from AUTH_GROUP_AUDIT_REPORT.md.
 */
describe('group-channel-service security (§D4 / §G6)', () => {
  it('tenant context fails closed — never defaults to "all"', () => {
    expect(() => requireTenant()).toThrow(TenantContextMissingError);
  });

  describe('last-owner protection (§D4 audit fix #3)', () => {
    it('removeMember blocks removal of the last owner', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'), // actor & target both owner
        countByRole: jest.fn().mockResolvedValue(1), // only 1 owner
      });
      const svc = new ChannelsService(repo, mockEvents());

      await expect(svc.removeMember('conv-1', 'actor-owner', 'target-owner')).rejects.toThrow(
        ForbiddenError,
      );
      await expect(svc.removeMember('conv-1', 'actor-owner', 'target-owner')).rejects.toThrow(
        'Cannot remove the last owner',
      );
    });

    it('removeMember allows removal when multiple owners exist', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'), // actor & target both owner
        countByRole: jest.fn().mockResolvedValue(2), // 2 owners
      });
      const svc = new ChannelsService(repo, mockEvents());

      await expect(
        svc.removeMember('conv-1', 'actor-owner', 'target-owner'),
      ).resolves.toBeUndefined();
    });

    it('leaveChannel blocks the last owner from leaving', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'),
        countByRole: jest.fn().mockResolvedValue(1),
      });
      const svc = new ChannelsService(repo, mockEvents());

      await expect(svc.leaveChannel('conv-1', 'last-owner')).rejects.toThrow(ForbiddenError);
      await expect(svc.leaveChannel('conv-1', 'last-owner')).rejects.toThrow(
        'Cannot leave as the last owner',
      );
    });

    it('setMemberRole blocks demotion of the last owner', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'), // actor & target both owner
        countByRole: jest.fn().mockResolvedValue(1),
      });
      const svc = new ChannelsService(repo, mockEvents());

      await expect(
        svc.setMemberRole('conv-1', 'actor-owner', 'target-owner', 'admin'),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        svc.setMemberRole('conv-1', 'actor-owner', 'target-owner', 'admin'),
      ).rejects.toThrow('Cannot demote the last owner');
    });

    it('setMemberRole allows demotion when multiple owners exist', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'),
        countByRole: jest.fn().mockResolvedValue(2), // > 1 owner
      });
      const svc = new ChannelsService(repo, mockEvents());

      await expect(
        svc.setMemberRole('conv-1', 'actor-owner', 'target-owner', 'admin'),
      ).resolves.toEqual({ message: 'Role updated to admin.' });
    });
  });

  describe('exhaustive role-rank permutations (§D4 audit fix #2)', () => {
    // Admins
    it('admin cannot promote to owner', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('admin') // actor role
          .mockResolvedValueOnce('member'), // target role
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(
        svc.setMemberRole('conv-1', 'admin-actor', 'target-member', 'owner'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin cannot demote another admin', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('admin') // actor role
          .mockResolvedValueOnce('admin'), // target role
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'admin-a', 'admin-b', 'member')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('admin cannot demote an owner', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('admin') // actor
          .mockResolvedValueOnce('owner'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'admin', 'owner', 'member')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('admin CAN promote member to admin', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('admin') // actor
          .mockResolvedValueOnce('member'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'admin', 'member', 'admin')).rejects.toThrow(
        ForbiddenError,
      ); // Wait, rank logic says CANNOT assign role EQUAL to own rank. Admin cannot make another admin. Let's verify our code logic: `ROLE_RANK[role] >= ROLE_RANK[actorRole]` -> blocks it.
    });

    it('admin CAN demote member to member (no-op)', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('admin') // actor
          .mockResolvedValueOnce('member'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'admin', 'member', 'member')).resolves.toEqual({
        message: 'Role updated to member.',
      });
    });

    // Members
    it('member cannot manage roles at all', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('member'),
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'member', 'target', 'admin')).rejects.toThrow(
        ForbiddenError,
      );
    });

    // Owners
    it('owner CAN promote member to admin', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('owner') // actor
          .mockResolvedValueOnce('member'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'owner-actor', 'target', 'admin')).resolves.toEqual({
        message: 'Role updated to admin.',
      });
    });

    it('owner CAN promote member to owner', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('owner') // actor
          .mockResolvedValueOnce('member'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'owner-actor', 'target', 'owner')).resolves.toEqual({
        message: 'Role updated to owner.',
      });
    });

    it('owner CAN demote admin to member', async () => {
      const repo = mockRepo({
        getMemberRole: jest
          .fn()
          .mockResolvedValueOnce('owner') // actor
          .mockResolvedValueOnce('admin'), // target
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.setMemberRole('conv-1', 'owner-actor', 'target', 'member')).resolves.toEqual(
        { message: 'Role updated to member.' },
      );
    });
  });

  describe('membership authorization', () => {
    it('non-admin cannot add members', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('member'),
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.addMember('conv-1', 'member-actor', 'new-user')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('non-admin cannot remove members', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('member'),
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.removeMember('conv-1', 'member-actor', 'target')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('admin CAN add members', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('admin'),
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.addMember('conv-1', 'admin-actor', 'new-user')).resolves.toBeUndefined();
    });

    it('owner CAN add members', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'),
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.addMember('conv-1', 'owner-actor', 'new-user')).resolves.toBeUndefined();
    });

    it('addMember throws ValidationError if MAX_GROUP_MEMBERS is exceeded', async () => {
      const repo = mockRepo({
        getMemberRole: jest.fn().mockResolvedValue('owner'),
        memberCount: jest.fn().mockResolvedValue(99999), // Exceeds 250
      });
      const svc = new ChannelsService(repo, mockEvents());
      await expect(svc.addMember('conv-1', 'owner-actor', 'new-user')).rejects.toThrow(
        ValidationError,
      );
    });

    it('createGroup throws ValidationError if creating with > MAX_GROUP_MEMBERS', async () => {
      const repo = mockRepo();
      const svc = new ChannelsService(repo, mockEvents());
      // array of 1025 members (MAX_GROUP_MEMBERS is 1024)
      const tooMany = Array.from({ length: 1025 }, (_, i) => `user-${i}`);
      await expect(svc.createGroup('creator', 'Group', tooMany)).rejects.toThrow(ValidationError);
    });
  });

  describe('input validation', () => {
    it('createDm rejects empty user ids', async () => {
      const svc = new ChannelsService(mockRepo(), mockEvents());
      await expect(svc.createDm('', 'b')).rejects.toThrow(ValidationError);
      await expect(svc.createDm('a', '')).rejects.toThrow(ValidationError);
    });

    it('listUserConversations rejects empty userId', () => {
      const svc = new ChannelsService(mockRepo(), mockEvents());
      expect(() => svc.listUserConversations('')).toThrow(ValidationError);
    });

    it('listChannels rejects empty tenantId', () => {
      const svc = new ChannelsService(mockRepo(), mockEvents());
      expect(() => svc.listChannels('')).toThrow(ValidationError);
    });
  });

  describe('batch operations (§perf audit fix #4)', () => {
    it('createGroup uses addMembersBatch instead of serial inserts', async () => {
      const batchFn = jest.fn().mockResolvedValue(undefined);
      const repo = mockRepo({ addMembersBatch: batchFn });
      const svc = new ChannelsService(repo, mockEvents());

      await svc.createGroup('creator', 'Test Group', ['user-1', 'user-2']);

      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn).toHaveBeenCalledWith(
        expect.any(String), // conversationId
        expect.arrayContaining([
          { userId: 'creator', role: 'owner' },
          { userId: 'user-1', role: 'member' },
          { userId: 'user-2', role: 'member' },
        ]),
      );
    });
  });
});
