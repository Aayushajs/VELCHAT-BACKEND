import type { PostgresClient } from '@velchat/database';
import type { MediaObject, MediaStatus, NewMedia, TranscodeResult } from './media.types';

/** Media metadata (§B11, Postgres `media_objects`). Blobs live in object storage; only metadata here. */
export class MediaRepository {
  constructor(private readonly pg: PostgresClient) {}

  async create(m: NewMedia): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO media_objects(media_id, owner_id, conversation_id, tenant_id, mime, encrypted, view_once, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        m.mediaId,
        m.ownerId,
        m.conversationId ?? null,
        m.tenantId ?? null,
        m.mime ?? null,
        m.encrypted,
        m.viewOnce,
      ],
    );
  }

  async markReady(
    mediaId: string,
    fields: { contentHash: string; size: number; mime: string | null; storageKey: string },
  ): Promise<void> {
    await this.pg.pool.query(
      `UPDATE media_objects SET status = 'ready', content_hash = $2, size = $3,
         mime = COALESCE($4, mime), storage_key = $5 WHERE media_id = $1`,
      [mediaId, fields.contentHash, fields.size, fields.mime, fields.storageKey],
    );
  }

  async setStatus(mediaId: string, status: MediaStatus): Promise<void> {
    await this.pg.pool.query('UPDATE media_objects SET status = $2 WHERE media_id = $1', [
      mediaId,
      status,
    ]);
  }

  async findById(mediaId: string): Promise<MediaObject | null> {
    const res = await this.pg.pool.query('SELECT * FROM media_objects WHERE media_id = $1', [
      mediaId,
    ]);
    return (res.rows[0] as MediaObject | undefined) ?? null;
  }

  /** Dedup lookup: any ready object already holding these exact bytes (content-addressed). */
  async findReadyByContentHash(contentHash: string): Promise<MediaObject | null> {
    const res = await this.pg.pool.query(
      "SELECT * FROM media_objects WHERE content_hash = $1 AND status = 'ready' LIMIT 1",
      [contentHash],
    );
    return (res.rows[0] as MediaObject | undefined) ?? null;
  }

  /** Per-conversation media gallery (§A16) — ready objects, newest first, cursor by created_at. */
  async listByConversation(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<MediaObject[]> {
    const res = await this.pg.pool.query(
      `SELECT * FROM media_objects
       WHERE conversation_id = $1 AND status = 'ready'
       ${before ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      before ? [conversationId, limit, before] : [conversationId, limit],
    );
    return res.rows as MediaObject[];
  }

  /** Delete the metadata row; returns the deleted row (to decide blob GC by refcount). */
  async deleteById(mediaId: string): Promise<MediaObject | null> {
    const res = await this.pg.pool.query(
      'DELETE FROM media_objects WHERE media_id = $1 RETURNING *',
      [mediaId],
    );
    return (res.rows[0] as MediaObject | undefined) ?? null;
  }

  /** How many OTHER rows still reference this blob (content-addressed refcount for safe GC). */
  async countOthersByStorageKey(storageKey: string, excludeMediaId: string): Promise<number> {
    const res = await this.pg.pool.query(
      'SELECT count(*)::int AS n FROM media_objects WHERE storage_key = $1 AND media_id <> $2',
      [storageKey, excludeMediaId],
    );
    return (res.rows[0] as { n: number } | undefined)?.n ?? 0;
  }

  /**
   * Atomically claim a view-once view (§C22). Sets viewed_at only if still null → exactly one
   * caller wins; a replay sees viewed_at already set. Returns true when this call claimed it.
   */
  async claimViewOnce(mediaId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      'UPDATE media_objects SET viewed_at = now() WHERE media_id = $1 AND viewed_at IS NULL',
      [mediaId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Write back transcode/thumbnail output (§B11 async pipeline, enterprise only). */
  async applyRenditions(mediaId: string, r: TranscodeResult): Promise<void> {
    await this.pg.pool.query(
      `UPDATE media_objects SET
         renditions = COALESCE($2, renditions),
         thumb_key  = COALESCE($3, thumb_key),
         blurhash   = COALESCE($4, blurhash),
         width      = COALESCE($5, width),
         height     = COALESCE($6, height),
         duration   = COALESCE($7, duration)
       WHERE media_id = $1`,
      [
        mediaId,
        r.renditions ? JSON.stringify(r.renditions) : null,
        r.thumbKey ?? null,
        r.blurhash ?? null,
        r.width ?? null,
        r.height ?? null,
        r.duration ?? null,
      ],
    );
  }
}
