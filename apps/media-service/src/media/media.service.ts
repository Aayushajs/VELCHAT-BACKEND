import { createHash } from 'node:crypto';
import { uuidv7, NotFoundError, ValidationError, ForbiddenError, GoneError } from '@velchat/common';
import type { ObjectStorage } from '@velchat/storage';
import { MediaRepository } from './media.repository';
import { MediaEvents } from './media.events';
import { storageKeyForHash, type MediaObject, type TranscodeResult } from './media.types';

export interface InitUploadInput {
  ownerId: string;
  mime?: string;
  conversationId?: string;
  tenantId?: string;
  encrypted?: boolean;
  viewOnce?: boolean;
}

const MAX_BYTES = 100 * 1024 * 1024; // 100MB cap per object (MVP)

/**
 * Media upload pipeline (§B11 / §A16). Content-addressed + deduped: the same bytes (ciphertext for
 * personal chats) hash to the same storage key, so a forwarded file stores once. For personal media
 * the server stores only ciphertext — it never transcodes or inspects it (E2EE boundary, §A14.3).
 */
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly events: MediaEvents,
  ) {}

  /** Reserve a media id; the client then PUTs the bytes to /media/uploads/:id. */
  async initUpload(input: InitUploadInput): Promise<{ mediaId: string; uploadPath: string }> {
    if (!input.ownerId) throw new ValidationError('ownerId is required');
    const mediaId = uuidv7();
    await this.repo.create({
      mediaId,
      ownerId: input.ownerId,
      conversationId: input.conversationId ?? null,
      tenantId: input.tenantId ?? null,
      mime: input.mime ?? null,
      encrypted: input.encrypted ?? false,
      viewOnce: input.viewOnce ?? false,
    });
    return { mediaId, uploadPath: `/media/uploads/${mediaId}` };
  }

  /** Store the bytes: content-hash → dedup → put (if new) → mark ready → emit file.uploaded. */
  async completeUpload(
    mediaId: string,
    bytes: Buffer,
    mime?: string,
  ): Promise<{ mediaId: string; status: string; deduped: boolean; storageKey: string }> {
    const media = await this.repo.findById(mediaId);
    if (!media) throw new NotFoundError('media not found — call init first');
    if (bytes.length === 0) throw new ValidationError('empty upload');
    if (bytes.length > MAX_BYTES) throw new ValidationError('upload exceeds size limit');

    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = storageKeyForHash(contentHash);

    // Dedup: if these exact bytes are already stored, reuse the key (don't upload again).
    const existing = await this.repo.findReadyByContentHash(contentHash);
    const deduped = existing !== null || (await this.storage.exists(storageKey));
    if (!deduped) {
      await this.storage.putObject({
        key: storageKey,
        body: bytes,
        contentType: mime ?? undefined,
      });
    }

    await this.repo.markReady(mediaId, {
      contentHash,
      size: bytes.length,
      mime: mime ?? media.mime,
      storageKey,
    });
    const ready: MediaObject = {
      ...media,
      content_hash: contentHash,
      size: bytes.length,
      mime: mime ?? media.mime,
      storage_key: storageKey,
      status: 'ready',
    };
    await this.events.fileUploaded(ready);
    return { mediaId, status: 'ready', deduped, storageKey };
  }

  /** Short-lived signed download URL (§B11). View-once enforcement lands with §C22. */
  async downloadUrl(
    mediaId: string,
    ttlSeconds = 300,
  ): Promise<{ url: string; mime: string | null }> {
    const media = await this.repo.findById(mediaId);
    if (!media || media.status !== 'ready' || !media.storage_key) {
      throw new NotFoundError('media not ready');
    }
    return {
      url: await this.storage.getSignedUrl(media.storage_key, ttlSeconds),
      mime: media.mime,
    };
  }

  async metadata(mediaId: string): Promise<MediaObject> {
    const media = await this.repo.findById(mediaId);
    if (!media) throw new NotFoundError('media not found');
    return media;
  }

  /** Per-conversation media gallery (§A16) — ready objects newest-first, cursor by created_at. */
  async gallery(conversationId: string, limit = 50, before?: string): Promise<MediaObject[]> {
    if (!conversationId) throw new ValidationError('conversationId is required');
    return this.repo.listByConversation(conversationId, Math.min(Math.max(limit, 1), 100), before);
  }

  /**
   * Delete a media object. Only the owner may delete. The blob is content-addressed, so it is
   * removed from storage only when no OTHER metadata row still references it (refcount → 0).
   */
  async deleteMedia(
    mediaId: string,
    actorId: string,
  ): Promise<{ deleted: true; blobRemoved: boolean }> {
    const media = await this.repo.findById(mediaId);
    if (!media) throw new NotFoundError('media not found');
    if (media.owner_id !== actorId)
      throw new ForbiddenError('only the owner can delete this media');
    return this.purge(media);
  }

  /**
   * View-once consume (§C22). Atomically claims the single view; a replay finds it already claimed
   * and gets 410 Gone. On the winning call we return the signed URL and delete the blob so it can
   * never be fetched again (replay-proof — the metadata gate closes even if a URL was cached).
   */
  async consumeViewOnce(
    mediaId: string,
    ttlSeconds = 60,
  ): Promise<{ url: string; mime: string | null }> {
    const media = await this.repo.findById(mediaId);
    if (!media || media.status !== 'ready' || !media.storage_key) {
      throw new NotFoundError('media not ready');
    }
    if (!media.view_once) throw new ValidationError('media is not view-once');
    if (!(await this.repo.claimViewOnce(mediaId))) {
      throw new GoneError('this view-once media has already been viewed');
    }
    const url = await this.storage.getSignedUrl(media.storage_key, ttlSeconds);
    await this.purge(media); // one-view → remove immediately (refcount-aware)
    return { url, mime: media.mime };
  }

  /**
   * Write back transcode/thumbnail output (§B11 async pipeline, enterprise only). Personal media is
   * encrypted ciphertext and is never transcoded — reject to keep the E2EE boundary explicit.
   */
  async applyRenditions(mediaId: string, result: TranscodeResult): Promise<MediaObject> {
    const media = await this.repo.findById(mediaId);
    if (!media) throw new NotFoundError('media not found');
    if (media.encrypted) throw new ValidationError('encrypted media is never transcoded (E2EE)');
    await this.repo.applyRenditions(mediaId, result);
    const updated = (await this.repo.findById(mediaId)) as MediaObject;
    await this.events.fileTranscoded(updated);
    return updated;
  }

  /** Remove metadata + (if last reference) the blob, then emit file.deleted. */
  private async purge(media: MediaObject): Promise<{ deleted: true; blobRemoved: boolean }> {
    await this.repo.deleteById(media.media_id);
    let blobRemoved = false;
    if (media.storage_key) {
      const others = await this.repo.countOthersByStorageKey(media.storage_key, media.media_id);
      if (others === 0) {
        await this.storage.deleteObject(media.storage_key);
        blobRemoved = true;
      }
    }
    await this.events.fileDeleted(media.media_id, media.conversation_id, media.tenant_id);
    return { deleted: true, blobRemoved };
  }
}
