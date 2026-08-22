export type MediaStatus = 'pending' | 'scanning' | 'ready' | 'infected';

/** Input to register a media object before its bytes arrive (§B11). */
export interface NewMedia {
  mediaId: string;
  ownerId: string;
  conversationId?: string | null;
  tenantId?: string | null;
  mime?: string | null;
  encrypted: boolean;
  viewOnce: boolean;
}

export interface MediaObject {
  media_id: string;
  owner_id: string;
  conversation_id: string | null;
  tenant_id: string | null;
  content_hash: string | null;
  mime: string | null;
  size: number | null;
  status: MediaStatus;
  encrypted: boolean;
  storage_key: string | null;
  renditions: Renditions | null;
  thumb_key: string | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  view_once: boolean;
  viewed_at: string | null;
  created_at: string;
}

/** Transcode output (enterprise only — personal media is ciphertext and never transcoded, §A16). */
export interface Renditions {
  hls?: string;
  '720p'?: string;
  '480p'?: string;
  webp?: Record<string, string>;
  [k: string]: unknown;
}

/** Fields a transcode/thumbnail worker writes back after processing (§B11 async pipeline). */
export interface TranscodeResult {
  renditions?: Renditions;
  thumbKey?: string;
  blurhash?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** Content-addressed storage key — same bytes (ciphertext for personal) → same key → stored once. */
export function storageKeyForHash(contentHash: string): string {
  return `media/${contentHash}`;
}
