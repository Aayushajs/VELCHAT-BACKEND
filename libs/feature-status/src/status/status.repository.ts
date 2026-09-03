import type { PostgresClient } from '@velchat/database';
import type { NewStatus, StatusPost, StatusViewer } from './status.types';

/** One page of viewers plus the cursor to continue from. */
export interface ViewerPage {
  viewers: StatusViewer[];
  /** Pass as `after` to get the next page; `null` when the list is exhausted. */
  nextCursor: string | null;
}

/**
 * Status/story metadata (§B8, Postgres). Personal status text is ciphertext — the server never
 * reads it.
 *
 * Every read filters `state = 'active' AND expires_at > now()`. That, not the sweep worker, is what
 * makes expiry and deletion correct: a worker outage delays cleanup but can never expose an expired
 * or deleted status.
 */
export class StatusRepository {
  constructor(private readonly pg: PostgresClient) {}

  async create(statusId: string, s: NewStatus, expiresAt: Date): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_posts(status_id, user_id, kind, media_id, text, bg, caption,
                                audience, e2ee, view_once, state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)`,
      [
        statusId,
        s.userId,
        s.kind,
        s.mediaId ?? null,
        s.text ?? null,
        s.bg ?? null,
        s.caption ?? null,
        JSON.stringify(s.audience),
        s.e2ee,
        s.viewOnce,
        expiresAt.toISOString(),
      ],
    );
  }

  async findActive(statusId: string): Promise<StatusPost | null> {
    const res = await this.pg.pool.query(
      `SELECT * FROM status_posts
       WHERE status_id = $1 AND state = 'active' AND expires_at > now()`,
      [statusId],
    );
    return (res.rows[0] as StatusPost | undefined) ?? null;
  }

  /** A user's still-active statuses, oldest first so sequential playback is chronological. */
  async listActiveByUser(userId: string): Promise<StatusPost[]> {
    const res = await this.pg.pool.query(
      `SELECT * FROM status_posts
       WHERE user_id = $1 AND state = 'active' AND expires_at > now()
       ORDER BY created_at ASC`,
      [userId],
    );
    return res.rows as StatusPost[];
  }

  /** Idempotent by primary key: a second view from another device cannot inflate the count. */
  async recordView(statusId: string, viewerId: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_views(status_id, viewer_id) VALUES ($1, $2)
       ON CONFLICT (status_id, viewer_id) DO NOTHING`,
      [statusId, viewerId],
    );
  }

  /**
   * One page of viewers, ordered by view time. Cursor pagination (never OFFSET) per §B1, served by
   * status_views_cursor_idx. `limit` is clamped by the caller.
   */
  async viewersPage(statusId: string, limit: number, after?: string): Promise<ViewerPage> {
    const res = await this.pg.pool.query(
      `SELECT viewer_id, viewed_at FROM status_views
       WHERE status_id = $1 AND ($2::timestamptz IS NULL OR viewed_at > $2::timestamptz)
       ORDER BY viewed_at ASC
       LIMIT $3`,
      [statusId, after ?? null, limit + 1], // +1 probes for a further page without a second query
    );
    const rows = res.rows as StatusViewer[];
    const page = rows.slice(0, limit);
    return {
      viewers: page,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.viewed_at ?? null) : null,
    };
  }

  async react(statusId: string, viewerId: string, emoji: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_reactions(status_id, viewer_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (status_id, viewer_id) DO UPDATE SET emoji = $3, ts = now()`,
      [statusId, viewerId, emoji],
    );
  }

  /**
   * Soft delete, author-scoped in the predicate so ownership is enforced in the same statement that
   * mutates. A hard DELETE would cascade status_views away, destroying the author's viewer data.
   */
  async softDelete(statusId: string, userId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      `UPDATE status_posts SET state = 'deleted', deleted_at = now()
       WHERE status_id = $1 AND user_id = $2 AND state = 'active'`,
      [statusId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Stage 1 of expiry: flip due rows to 'expired' and return their ids so events can be emitted.
   * Idempotent — the predicate only matches rows still active, so a re-run is a no-op and a crash
   * mid-pass loses nothing.
   */
  async markExpired(limit = 500): Promise<Array<{ status_id: string; user_id: string }>> {
    const res = await this.pg.pool.query(
      `UPDATE status_posts SET state = 'expired'
       WHERE status_id IN (
         SELECT status_id FROM status_posts
         WHERE state = 'active' AND expires_at <= now()
         ORDER BY expires_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING status_id, user_id`,
      [limit],
    );
    return res.rows as Array<{ status_id: string; user_id: string }>;
  }

  /**
   * Stage 2: hard-delete expired/deleted rows past the grace window. The window is what lets Phase 2
   * reclaim media asynchronously without racing this purge.
   */
  async purgeAfterGrace(graceHours: number): Promise<number> {
    const res = await this.pg.pool.query(
      `DELETE FROM status_posts
       WHERE state IN ('expired', 'deleted')
         AND expires_at <= now() - ($1 || ' hours')::interval`,
      [String(graceHours)],
    );
    return res.rowCount ?? 0;
  }
}
