import type { PostgresClient } from '@velchat/database';
import type { MediaObject, MediaStatus, NewMedia } from './media.types';

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
}
