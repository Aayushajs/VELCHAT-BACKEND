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
  view_once: boolean;
  created_at: string;
}

/** Content-addressed storage key — same bytes (ciphertext for personal) → same key → stored once. */
export function storageKeyForHash(contentHash: string): string {
  return `media/${contentHash}`;
}
