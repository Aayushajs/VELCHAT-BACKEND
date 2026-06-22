import { uuidv7, ValidationError, ForbiddenError, NotFoundError } from '@velchat/common';
import { TenancyRepository } from './tenancy.repository';
import { TenancyEvents } from './tenancy.events';
import { roleAtLeast, type Membership, type Role, type ScopeType } from './tenancy.types';

/**
 * Orgs / workspaces / teams + per-tenant RBAC (§B3 / §A13 / §A14.2). The creator becomes owner;
 * member management is gated by role rank (admin+). A user's role in one scope is independent of any
 * other. Authorization is enforced server-side here — never trusted from the client.
 */
export class TenancyService {
  constructor(
    private readonly repo: TenancyRepository,
    private readonly events: TenancyEvents,
  ) {}

  async createOrg(creator: string, name: string): Promise<{ orgId: string }> {
    if (!creator || !name) throw new ValidationError('creator and name are required');
    const orgId = uuidv7();
    await this.repo.createOrg(orgId, name, creator);
    await this.repo.addMember(creator, 'org', orgId, 'owner');
    await this.events.orgCreated(orgId, name, creator);
    await this.events.memberAdded('org', orgId, creator, 'owner');
    return { orgId };
  }

  async createWorkspace(
    creator: string,
    name: string,
    orgId: string | null = null,
  ): Promise<{ workspaceId: string }> {
    if (!creator || !name) throw new ValidationError('creator and name are required');
    const workspaceId = uuidv7();
    await this.repo.createWorkspace(workspaceId, name, orgId, creator);
    await this.repo.addMember(creator, 'workspace', workspaceId, 'owner');
    await this.events.memberAdded('workspace', workspaceId, creator, 'owner');
    return { workspaceId };
  }

  async createTeam(creator: string, orgId: string, name: string): Promise<{ teamId: string }> {
    if (!orgId || !name) throw new ValidationError('orgId and name are required');
    await this.assertRole(creator, 'org', orgId, 'admin'); // only org admins+ create teams
    const teamId = uuidv7();
    await this.repo.createTeam(teamId, orgId, name, creator);
    await this.repo.addMember(creator, 'team', teamId, 'owner');
    await this.events.memberAdded('team', teamId, creator, 'owner');
    return { teamId };
  }

  async addMember(
    actorId: string,
    scopeType: ScopeType,
    scopeId: string,
    userId: string,
    role: Role = 'member',
  ): Promise<void> {
    await this.assertRole(actorId, scopeType, scopeId, 'admin');
    if (role === 'owner') throw new ValidationError('cannot grant owner via addMember');
    await this.repo.addMember(userId, scopeType, scopeId, role);
    await this.events.memberAdded(scopeType, scopeId, userId, role);
  }

  async removeMember(
    actorId: string,
    scopeType: ScopeType,
    scopeId: string,
    userId: string,
  ): Promise<void> {
    await this.assertRole(actorId, scopeType, scopeId, 'admin');
    await this.repo.removeMember(userId, scopeType, scopeId);
  }

  async members(scopeType: ScopeType, scopeId: string): Promise<Membership[]> {
    return this.repo.members(scopeType, scopeId);
  }

  async myMemberships(userId: string): Promise<Membership[]> {
    return this.repo.membershipsOf(userId);
  }

  /** §A14.2 authorization API: is `userId` allowed `min` role (or higher) in this scope? */
  async authorize(
    userId: string,
    scopeType: ScopeType,
    scopeId: string,
    min: Role,
  ): Promise<{ allowed: boolean; role: Role | null }> {
    const role = await this.repo.getRole(userId, scopeType, scopeId);
    return { allowed: role !== null && roleAtLeast(role, min), role };
  }

  private async assertRole(
    userId: string,
    scopeType: ScopeType,
    scopeId: string,
    min: Role,
  ): Promise<void> {
    const role = await this.repo.getRole(userId, scopeType, scopeId);
    if (role === null) throw new NotFoundError('not a member of this scope');
    if (!roleAtLeast(role, min)) throw new ForbiddenError(`requires ${min} or higher`);
  }
}
