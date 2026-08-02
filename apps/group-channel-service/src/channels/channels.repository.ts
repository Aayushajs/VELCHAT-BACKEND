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

  /**
   * Rotate the Sender-Key epoch on a membership change (§G1-2) — only for personal groups, which
   * are the conversations that use Sender Keys. Returns the new epoch, or null if not a group.
   */
  async bumpSenderKeyEpochIfGroup(conversationId: string): Promise<number | null> {
    const res = await this.pg.pool.query(
      "UPDATE conversations SET sender_key_epoch = sender_key_epoch + 1 WHERE conversation_id = $1 AND type = 'group' RETURNING sender_key_epoch",
      [conversationId],
    );
    const row = res.rows[0] as { sender_key_epoch: string } | undefined;
    return row ? Number(row.sender_key_epoch) : null;
  }

  /**
   * The inbox: every conversation the user is a member of (§M0 — the client has no other way
   * to re-enumerate its DMs/groups after a reinstall/cold start; there is no message list here,
   * the client backfills per conversation). Newest-created first; page-capped.
   */
  async listConversationsForUser(
    userId: string,
    limit = 500,
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.pg.pool.query(
      `SELECT c.* FROM conversations c
         JOIN conversation_members m ON m.conversation_id = c.conversation_id
        WHERE m.user_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return res.rows as Array<Record<string, unknown>>;
  }

  // ── conversation details + channel discovery/update (§B7) ──
  async getConversation(conversationId: string): Promise<Record<string, unknown> | null> {
    const res = await this.pg.pool.query('SELECT * FROM conversations WHERE conversation_id = $1', [
      conversationId,
    ]);
    return (res.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  /** Discover channels in a tenant. `onlyPublic` restricts to publicly-joinable ones. */
  async listChannels(
    tenantId: string,
    onlyPublic: boolean,
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.pg.pool.query(
      `SELECT * FROM conversations
       WHERE type = 'channel' AND tenant_id = $1
       ${onlyPublic ? "AND visibility = 'public'" : ''}
       ORDER BY created_at DESC LIMIT 200`,
      [tenantId],
    );
    return res.rows as Array<Record<string, unknown>>;
  }

  async updateConversation(
    conversationId: string,
    p: {
      name?: string;
      topic?: string;
      avatarMediaId?: string;
      visibility?: string;
      isAnnouncement?: boolean;
      settings?: unknown;
    },
  ): Promise<Record<string, unknown> | null> {
    const res = await this.pg.pool.query(
      `UPDATE conversations SET
         name = COALESCE($2, name),
         topic = COALESCE($3, topic),
         avatar_media_id = COALESCE($4, avatar_media_id),
         visibility = COALESCE($5, visibility),
         is_announcement = COALESCE($6, is_announcement),
         settings = COALESCE($7, settings)
       WHERE conversation_id = $1 RETURNING *`,
      [
        conversationId,
        p.name ?? null,
        p.topic ?? null,
        p.avatarMediaId ?? null,
        p.visibility ?? null,
        p.isAnnouncement ?? null,
        p.settings !== undefined ? JSON.stringify(p.settings) : null,
      ],
    );
    return (res.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async setMemberRole(conversationId: string, userId: string, role: MemberRole): Promise<void> {
    await this.pg.pool.query(
      'UPDATE conversation_members SET role = $3 WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId, role],
    );
  }

  async setNotifLevel(conversationId: string, userId: string, level: string): Promise<void> {
    await this.pg.pool.query(
      'UPDATE conversation_members SET notif_level = $3 WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId, level],
    );
  }

  // ── communities (group-of-groups + announcement channel, §B7) ──
  async createCommunity(
    communityId: string,
    name: string,
    orgId: string | null,
    announcementChannelId: string | null,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO communities(community_id, name, org_id, announcement_channel_id) VALUES ($1,$2,$3,$4)`,
      [communityId, name, orgId, announcementChannelId],
    );
  }

  async getCommunity(communityId: string): Promise<Record<string, unknown> | null> {
    const res = await this.pg.pool.query('SELECT * FROM communities WHERE community_id = $1', [
      communityId,
    ]);
    return (res.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async attachChannelToCommunity(conversationId: string, communityId: string): Promise<void> {
    await this.pg.pool.query(
      'UPDATE conversations SET parent_community_id = $2 WHERE conversation_id = $1',
      [conversationId, communityId],
    );
  }

  async listCommunityChannels(communityId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.pg.pool.query(
      'SELECT * FROM conversations WHERE parent_community_id = $1 ORDER BY created_at',
      [communityId],
    );
    return res.rows as Array<Record<string, unknown>>;
  }
}
