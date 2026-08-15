import type { PostgresClient } from '@velchat/database';
import type { Membership, Role, ScopeType } from './tenancy.types';

/** Orgs / workspaces / teams / memberships (§B3, Postgres). One service owns these tables (§A10). */
export class TenancyRepository {
  constructor(private readonly pg: PostgresClient) {}

  async createOrg(orgId: string, name: string, createdBy: string): Promise<void> {
    await this.pg.pool.query(
      'INSERT INTO organizations(org_id, name, created_by) VALUES ($1, $2, $3)',
      [orgId, name, createdBy],
    );
  }

  async createWorkspace(
    workspaceId: string,
    name: string,
    orgId: string | null,
    createdBy: string,
  ): Promise<void> {
    await this.pg.pool.query(
      'INSERT INTO workspaces(workspace_id, name, org_id, created_by) VALUES ($1, $2, $3, $4)',
      [workspaceId, name, orgId, createdBy],
    );
  }

  async createTeam(teamId: string, orgId: string, name: string, createdBy: string): Promise<void> {
    await this.pg.pool.query(
      'INSERT INTO teams(team_id, org_id, name, created_by) VALUES ($1, $2, $3, $4)',
      [teamId, orgId, name, createdBy],
    );
  }

  async addMember(
    userId: string,
    scopeType: ScopeType,
    scopeId: string,
    role: Role,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO memberships(user_id, scope_type, scope_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, scope_type, scope_id) DO UPDATE SET role = $4`,
      [userId, scopeType, scopeId, role],
    );
  }

  async removeMember(userId: string, scopeType: ScopeType, scopeId: string): Promise<void> {
    await this.pg.pool.query(
      'DELETE FROM memberships WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3',
      [userId, scopeType, scopeId],
    );
  }

  async getRole(userId: string, scopeType: ScopeType, scopeId: string): Promise<Role | null> {
    const res = await this.pg.pool.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3',
      [userId, scopeType, scopeId],
    );
    return (res.rows[0] as { role: Role } | undefined)?.role ?? null;
  }

  async members(scopeType: ScopeType, scopeId: string): Promise<Membership[]> {
    const res = await this.pg.pool.query(
      'SELECT user_id, scope_type, scope_id, role, joined_at FROM memberships WHERE scope_type = $1 AND scope_id = $2',
      [scopeType, scopeId],
    );
    return res.rows as Membership[];
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    const res = await this.pg.pool.query(
      'SELECT user_id, scope_type, scope_id, role, joined_at FROM memberships WHERE user_id = $1',
      [userId],
    );
    return res.rows as Membership[];
  }
}
