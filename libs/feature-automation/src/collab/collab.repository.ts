import type { PostgresClient } from '@velchat/database';
import type { ClipRow, CanvasRow } from '@velchat/database';
import { uuidv7 } from '@velchat/common';

/** Clips + Canvas data access (§A4.7, Postgres). Canvas updates are optimistic-concurrency guarded. */
export class CollabRepository {
  constructor(private readonly pg: PostgresClient) {}

  // ── clips ──
  async createClip(c: {
    conversationId: string;
    mediaId: string;
    postedBy: string;
    caption: string | null;
    durationSec: number | null;
  }): Promise<ClipRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO clips(clip_id, conversation_id, media_id, posted_by, caption, duration_sec)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuidv7(), c.conversationId, c.mediaId, c.postedBy, c.caption, c.durationSec],
    );
    return res.rows[0] as ClipRow;
  }

  async listClips(conversationId: string): Promise<ClipRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM clips WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 100',
      [conversationId],
    );
    return res.rows as ClipRow[];
  }

  async deleteClip(clipId: string): Promise<void> {
    await this.pg.pool.query('DELETE FROM clips WHERE clip_id = $1', [clipId]);
  }

  // ── canvas ──
  async createCanvas(c: {
    conversationId: string;
    title: string;
    content: unknown;
    createdBy: string;
  }): Promise<CanvasRow> {
    const id = uuidv7();
    const res = await this.pg.pool.query(
      `INSERT INTO canvases(canvas_id, conversation_id, title, content, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [id, c.conversationId, c.title, JSON.stringify(c.content), c.createdBy],
    );
    return res.rows[0] as CanvasRow;
  }

  async getCanvas(canvasId: string): Promise<CanvasRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM canvases WHERE canvas_id = $1', [canvasId]);
    return (res.rows[0] as CanvasRow | undefined) ?? null;
  }

  async listCanvases(conversationId: string): Promise<CanvasRow[]> {
    const res = await this.pg.pool.query(
      'SELECT canvas_id, conversation_id, title, version, updated_by, updated_at, created_at, created_by FROM canvases WHERE conversation_id = $1 ORDER BY updated_at DESC',
      [conversationId],
    );
    return res.rows as CanvasRow[];
  }

  /**
   * Optimistic-concurrency update: only writes if the stored version still equals `expectedVersion`,
   * bumping it by 1. Returns the updated row, or null if the version moved (a concurrent edit won).
   */
  async updateCanvas(
    canvasId: string,
    expectedVersion: number,
    patch: { title?: string; content?: unknown; updatedBy: string },
  ): Promise<CanvasRow | null> {
    const res = await this.pg.pool.query(
      `UPDATE canvases SET
         title = COALESCE($3, title),
         content = COALESCE($4, content),
         updated_by = $5,
         version = version + 1,
         updated_at = now()
       WHERE canvas_id = $1 AND version = $2
       RETURNING *`,
      [
        canvasId,
        expectedVersion,
        patch.title ?? null,
        patch.content !== undefined ? JSON.stringify(patch.content) : null,
        patch.updatedBy,
      ],
    );
    return (res.rows[0] as CanvasRow | undefined) ?? null;
  }
}
