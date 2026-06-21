import type { PostgresClient } from '@velchat/database';
import type { MemberRole, NewConversation } from './conversation.types';

/** Conversations + membership (§B7, Postgres). One service owns these tables (§A10). */
export class ChannelsRepository {
  constructor(private readonly pg: PostgresClient) {}

  /** Returns true if newly created, false if it already existed (DM dedupe). */
  async createConversation(c: NewConversation): Promise<boolean> {
    const res = await this.pg.pool.query(
      `INSERT INTO conversations(conversation_id, type, tenant_id, name, visibility, is_announcement, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (conversation_id) DO NOTHING`,
      [
        c.conversationId,
        c.type,
        c.tenantId ?? null,
        c.name ?? null,
        c.visibility ?? null,
        c.isAnnouncement ?? false,
        c.createdBy,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addMember(
    conversationId: string,
    userId: string,
    role: MemberRole = 'member',
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO conversation_members(conversation_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, userId, role],
    );
  }

  async removeMember(conversationId: string, userId: string): Promise<void> {
    await this.pg.pool.query(
      'DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
  }

  /** Recipient set for fan-out (§B9.2) and ACL checks. */
  async listMemberUserIds(conversationId: string): Promise<string[]> {
    const res = await this.pg.pool.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
      [conversationId],
    );
    return (res.rows as Array<{ user_id: string }>).map((r) => r.user_id);
  }

  async getMemberRole(conversationId: string, userId: string): Promise<MemberRole | null> {
    const res = await this.pg.pool.query(
      'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    return (res.rows[0] as { role: MemberRole } | undefined)?.role ?? null;
  }

  async memberCount(conversationId: string): Promise<number> {
    const res = await this.pg.pool.query(
      'SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1',
      [conversationId],
    );
    return (res.rows[0] as { n: number } | undefined)?.n ?? 0;
  }

  async updateLastRead(conversationId: string, userId: string, seq: number): Promise<void> {
    await this.pg.pool.query(
      'UPDATE conversation_members SET last_read_seq = $3 WHERE conversation_id = $1 AND user_id = $2 AND last_read_seq < $3',
      [conversationId, userId, seq],
    );
  }
}
