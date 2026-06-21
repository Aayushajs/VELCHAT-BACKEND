import { createHash } from 'node:crypto';
import { uuidv7, NotFoundError, ValidationError } from '@velchat/common';
import type { ObjectStorage } from '@velchat/storage';
import { MediaRepository } from './media.repository';
import { MediaEvents } from './media.events';
import { storageKeyForHash, type MediaObject } from './media.types';

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
}
