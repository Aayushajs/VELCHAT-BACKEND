import { ChannelsService } from '../../src/channels/channels.service';
import { ValidationError, ForbiddenError } from '@velchat/common';
import type { MemberRole } from '../../src/channels/conversation.types';

function makeChannels() {
  const repo = {
    createConversation: jest.fn(async () => true),
    addMember: jest.fn(async () => undefined),
    removeMember: jest.fn(async () => undefined),
    listMemberUserIds: jest.fn(async () => [] as string[]),
    getMemberRole: jest.fn(async (): Promise<MemberRole | null> => 'owner'),
    memberCount: jest.fn(async () => 2),
    updateLastRead: jest.fn(async () => undefined),
    bumpSenderKeyEpochIfGroup: jest.fn(async (): Promise<number | null> => 2),
  };
  const events = {
    conversationCreated: jest.fn(async () => undefined),
    memberAdded: jest.fn(async () => undefined),
    memberRemoved: jest.fn(async () => undefined),
    groupEpochChanged: jest.fn(async () => undefined),
  };
  const svc = new ChannelsService(repo as never, events as never);
  return { svc, repo, events };
}

describe('ChannelsService (§B7)', () => {
  it('creates a DM with both members and a created event', async () => {
    const { svc, repo, events } = makeChannels();
    const res = await svc.createDm('a', 'b');
    expect(res.created).toBe(true);
    expect(repo.addMember).toHaveBeenCalledTimes(2);
    expect(events.conversationCreated).toHaveBeenCalledTimes(1);
  });

  it('dedupes an existing DM (no extra members or events)', async () => {
    const { svc, repo, events } = makeChannels();
    repo.createConversation.mockResolvedValueOnce(false); // already existed
    const res = await svc.createDm('a', 'b');
    expect(res.created).toBe(false);
    expect(repo.addMember).not.toHaveBeenCalled();
    expect(events.conversationCreated).not.toHaveBeenCalled();
  });

  it('rejects a DM with the same user on both sides', async () => {
    const { svc } = makeChannels();
    await expect(svc.createDm('a', 'a')).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a group with the creator as owner', async () => {
    const { svc, repo, events } = makeChannels();
    await svc.createGroup('owner', 'Team', ['u2', 'u3']);
    expect(repo.addMember).toHaveBeenCalledWith(expect.any(String), 'owner', 'owner');
    expect(events.conversationCreated).toHaveBeenCalledWith(
      expect.any(String),
      'group',
      null,
      'owner',
      ['owner', 'u2', 'u3'],
    );
  });

  it('only owner/admin can add members', async () => {
    const { svc, repo } = makeChannels();
    repo.getMemberRole.mockResolvedValueOnce('member'); // actor is a plain member
    await expect(svc.addMember('conv-1', 'actor', 'newbie')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('admin can add a member (emits channel.member.added)', async () => {
    const { svc, repo, events } = makeChannels();
    repo.getMemberRole.mockResolvedValueOnce('admin');
    await svc.addMember('conv-1', 'actor', 'newbie');
    expect(repo.addMember).toHaveBeenCalledWith('conv-1', 'newbie', 'member');
    expect(events.memberAdded).toHaveBeenCalled();
  });

  it('rotates the sender-key epoch on member removal (§G1-2)', async () => {
    const { svc, repo, events } = makeChannels();
    await svc.removeMember('conv-1', 'owner', 'bob');
    expect(repo.bumpSenderKeyEpochIfGroup).toHaveBeenCalledWith('conv-1');
    expect(events.groupEpochChanged).toHaveBeenCalledWith('conv-1', 2, 'member.removed');
  });

  it('does not emit an epoch change for a non-group (bump returns null)', async () => {
    const { svc, repo, events } = makeChannels();
    repo.bumpSenderKeyEpochIfGroup.mockResolvedValueOnce(null); // a channel, not a group
    await svc.addMember('chan-1', 'owner', 'newbie');
    expect(events.groupEpochChanged).not.toHaveBeenCalled();
  });
});
