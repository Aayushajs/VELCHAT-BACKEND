export type ScopeType = 'org' | 'workspace' | 'team';
export type Role = 'owner' | 'admin' | 'member' | 'guest' | 'bot';

/** Role rank for hierarchy checks (owner > admin > member > guest; bot is side-channel). */
const RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, guest: 1, bot: 0 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export interface Membership {
  user_id: string;
  scope_type: ScopeType;
  scope_id: string;
  role: Role;
  joined_at: string;
}
