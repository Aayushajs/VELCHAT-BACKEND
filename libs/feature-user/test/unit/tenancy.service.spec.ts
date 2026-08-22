import { TenancyService } from '../../src/tenancy/tenancy.service';
import { roleAtLeast, type Role } from '../../src/tenancy/tenancy.types';
import { ForbiddenError, NotFoundError, ValidationError } from '@velchat/common';
import type { TenancyRepository } from '../../src/tenancy/tenancy.repository';
import type { TenancyEvents } from '../../src/tenancy/tenancy.events';

function setup(actorRole: Role | null = 'owner') {
  const repo = {
    createOrg: jest.fn(async () => undefined),
    createWorkspace: jest.fn(async () => undefined),
    createTeam: jest.fn(async () => undefined),
    addMember: jest.fn(async () => undefined),
    removeMember: jest.fn(async () => undefined),
    getRole: jest.fn(async (): Promise<Role | null> => actorRole),
    members: jest.fn(async () => []),
    membershipsOf: jest.fn(async () => []),
  } as unknown as TenancyRepository;
  const events = {
    orgCreated: jest.fn(async () => undefined),
    memberAdded: jest.fn(async () => undefined),
  } as unknown as TenancyEvents;
  return { svc: new TenancyService(repo, events), repo, events };
}

describe('roleAtLeast (§A14.2)', () => {
  it('respects the hierarchy owner > admin > member > guest', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
  });
});

describe('TenancyService (§B3)', () => {
  it('createOrg makes the creator owner + emits org.created + member.added', async () => {
    const { svc, repo, events } = setup();
    const res = await svc.createOrg('alice', 'Acme');
    expect(repo.addMember).toHaveBeenCalledWith('alice', 'org', res.orgId, 'owner');
    expect(events.orgCreated).toHaveBeenCalled();
    expect(events.memberAdded).toHaveBeenCalledWith('org', res.orgId, 'alice', 'owner');
  });

  it('addMember requires admin+ in the scope', async () => {
    const { svc } = setup('member'); // actor is only a member
    await expect(svc.addMember('actor', 'org', 'o1', 'bob')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('admin can add a member and it emits member.added', async () => {
    const { svc, repo, events } = setup('admin');
    await svc.addMember('actor', 'org', 'o1', 'bob', 'member');
    expect(repo.addMember).toHaveBeenCalledWith('bob', 'org', 'o1', 'member');
    expect(events.memberAdded).toHaveBeenCalledWith('org', 'o1', 'bob', 'member');
  });

  it('cannot grant owner via addMember', async () => {
    const { svc } = setup('owner');
    await expect(svc.addMember('actor', 'org', 'o1', 'bob', 'owner')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('addMember on a scope you are not in throws NotFound', async () => {
    const { svc } = setup(null); // actor has no membership
    await expect(svc.addMember('actor', 'org', 'o1', 'bob')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('authorize reports allowed + role', async () => {
    const { svc } = setup('admin');
    expect(await svc.authorize('u', 'org', 'o1', 'member')).toEqual({
      allowed: true,
      role: 'admin',
    });
    expect(await svc.authorize('u', 'org', 'o1', 'owner')).toEqual({
      allowed: false,
      role: 'admin',
    });
  });
});
