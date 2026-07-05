import { ValidationError, NotFoundError, ConflictError } from '@velchat/common';
import type { ClipRow, CanvasRow } from '@velchat/database';
import { CollabRepository } from './collab.repository';

/** Clips + Canvas (§A4.7). Clips reference media-service uploads; canvas is a versioned collab doc. */
export class CollabService {
  constructor(private readonly repo: CollabRepository) {}

  // ── clips ──
  async postClip(input: {
    conversationId: string;
    mediaId: string;
    postedBy: string;
    caption?: string;
    durationSec?: number;
  }): Promise<ClipRow> {
    if (!input.conversationId || !input.mediaId || !input.postedBy) {
      throw new ValidationError('conversationId, mediaId and postedBy are required');
    }
    return this.repo.createClip({
      conversationId: input.conversationId,
      mediaId: input.mediaId,
      postedBy: input.postedBy,
      caption: input.caption ?? null,
      durationSec: input.durationSec ?? null,
    });
  }

  listClips(conversationId: string): Promise<ClipRow[]> {
    return this.repo.listClips(conversationId);
  }

  async deleteClip(clipId: string): Promise<{ message: string }> {
    await this.repo.deleteClip(clipId);
    return { message: 'Clip deleted.' };
  }

  // ── canvas ──
  async createCanvas(input: {
    conversationId: string;
    title: string;
    content?: unknown;
    createdBy: string;
  }): Promise<CanvasRow> {
    if (!input.conversationId || !input.title || !input.createdBy) {
      throw new ValidationError('conversationId, title and createdBy are required');
    }
    return this.repo.createCanvas({
      conversationId: input.conversationId,
      title: input.title,
      content: input.content ?? [],
      createdBy: input.createdBy,
    });
  }

  async getCanvas(canvasId: string): Promise<CanvasRow> {
    const c = await this.repo.getCanvas(canvasId);
    if (!c) throw new NotFoundError('canvas not found');
    return c;
  }

  listCanvases(conversationId: string): Promise<CanvasRow[]> {
    return this.repo.listCanvases(conversationId);
  }

  /** Optimistic update: rejects with 409 if another edit bumped the version first (§A4.7 co-editing). */
  async updateCanvas(
    canvasId: string,
    expectedVersion: number,
    patch: { title?: string; content?: unknown; updatedBy: string },
  ): Promise<CanvasRow> {
    const current = await this.repo.getCanvas(canvasId);
    if (!current) throw new NotFoundError('canvas not found');
    const updated = await this.repo.updateCanvas(canvasId, expectedVersion, patch);
    if (!updated) {
      throw new ConflictError(
        `canvas was edited concurrently (expected version ${expectedVersion}, now ${current.version}) — reload and retry`,
      );
    }
    return updated;
  }
}
