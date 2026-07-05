import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { FileUploadedPayload } from '@velchat/shared-types';
import type { MediaObject } from './media.types';

/** Media events (§A11) → consumed by chat (attach to message), search, ai (caption/scan). */
export class MediaEvents {
  constructor(private readonly bus: EventBus) {}

  async fileUploaded(m: MediaObject): Promise<void> {
    await this.bus.publish<FileUploadedPayload>(
      'file.uploaded',
      buildEnvelope({
        eventType: 'file.uploaded',
        key: m.media_id,
        producer: 'media-service',
        tenantId: m.tenant_id,
        payload: {
          media_id: m.media_id,
          owner_id: m.owner_id,
          conversation_id: m.conversation_id,
          tenant_id: m.tenant_id,
          mime: m.mime,
          size: m.size,
          content_hash: m.content_hash ?? '',
          encrypted: m.encrypted,
          uploaded_at: new Date().toISOString(),
        },
      }),
    );
  }

  /** Transcode/thumbnail done (§A11 file.transcoded) → chat updates the attachment, realtime pushes. */
  async fileTranscoded(m: MediaObject): Promise<void> {
    await this.bus.publish(
      'file.transcoded',
      buildEnvelope({
        eventType: 'file.transcoded',
        key: m.media_id,
        producer: 'media-service',
        tenantId: m.tenant_id,
        payload: {
          media_id: m.media_id,
          conversation_id: m.conversation_id,
          renditions: m.renditions,
          thumb_key: m.thumb_key,
          blurhash: m.blurhash,
          width: m.width,
          height: m.height,
          duration: m.duration,
        },
      }),
    );
  }

  /** Blob + metadata removed (view-once consume or explicit delete) → chat/search purge the reference. */
  async fileDeleted(
    mediaId: string,
    conversationId: string | null,
    tenantId: string | null,
  ): Promise<void> {
    await this.bus.publish(
      'file.deleted',
      buildEnvelope({
        eventType: 'file.deleted',
        key: mediaId,
        producer: 'media-service',
        tenantId,
        payload: { media_id: mediaId, conversation_id: conversationId, tenant_id: tenantId },
      }),
    );
  }
}
