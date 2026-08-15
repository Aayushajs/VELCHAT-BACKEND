import type { PostgresClient } from '@velchat/database';
import type { NewStatus, StatusPost, StatusViewer } from './status.types';

/** Status/story metadata (§B8, Postgres). Personal status text is ciphertext — server never reads it. */
export class StatusRepository {
  constructor(private readonly pg: PostgresClient) {}

  async create(statusId: string, s: NewStatus, expiresAt: Date): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_posts(status_id, user_id, kind, media_id, text, bg, caption, audience, e2ee, view_once, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      'SELECT * FROM status_posts WHERE status_id = $1 AND expires_at > now()',
      [statusId],
    );
    return (res.rows[0] as StatusPost | undefined) ?? null;
  }

  /** A user's own still-active statuses (newest first). */
  async listByUser(userId: string): Promise<StatusPost[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM status_posts WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC',
      [userId],
    );
    return res.rows as StatusPost[];
  }

  async recordView(statusId: string, viewerId: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_views(status_id, viewer_id) VALUES ($1, $2)
       ON CONFLICT (status_id, viewer_id) DO NOTHING`,
      [statusId, viewerId],
    );
  }

  /** Viewer list for the author (ordered by time) — respects nothing here; privacy applied in service. */
  async viewers(statusId: string): Promise<StatusViewer[]> {
    const res = await this.pg.pool.query(
      'SELECT viewer_id, viewed_at FROM status_views WHERE status_id = $1 ORDER BY viewed_at ASC',
      [statusId],
    );
    return res.rows as StatusViewer[];
  }

  async react(statusId: string, viewerId: string, emoji: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_reactions(status_id, viewer_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (status_id, viewer_id) DO UPDATE SET emoji = $3, ts = now()`,
      [statusId, viewerId, emoji],
    );
  }

  async delete(statusId: string, userId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      'DELETE FROM status_posts WHERE status_id = $1 AND user_id = $2',
      [statusId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Periodic purge of expired statuses (a cron calls this; reads already filter on expires_at). */
  async purgeExpired(): Promise<number> {
    const res = await this.pg.pool.query('DELETE FROM status_posts WHERE expires_at <= now()');
    return res.rowCount ?? 0;
  }
}
