-- 0006 — media-service metadata (§B11). Blobs live in object storage (Cloudinary/MinIO); only
-- metadata is relational. Content-addressed (content_hash) so the same file forwarded many times
-- stores once (dedup). For personal chats `encrypted = true` — the server stores only ciphertext
-- and never transcodes/inspects it (§A16). Expand-only.

CREATE TABLE IF NOT EXISTS media_objects (
  media_id        uuid PRIMARY KEY,                       -- app-generated UUIDv7 handle
  owner_id        uuid NOT NULL,
  conversation_id text,                                   -- optional: which chat this belongs to
  tenant_id       uuid,                                   -- set for enterprise/channel media
  content_hash    text,                                   -- sha256(bytes) → dedup + content address
  mime            text,
  size            bigint,
  status          text NOT NULL DEFAULT 'pending',        -- pending|scanning|ready|infected
  encrypted       boolean NOT NULL DEFAULT false,         -- true for personal E2EE (ciphertext only)
  storage_key     text,                                   -- key in object storage
  renditions      jsonb,                                  -- {hls, 720p, webp...} (enterprise transcode)
  thumb_key       text,
  blurhash        text,
  width           int,
  height          int,
  duration        int,
  view_once       boolean NOT NULL DEFAULT false,         -- §C22 one-view media
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media_objects (owner_id);
CREATE INDEX IF NOT EXISTS media_hash_idx ON media_objects (content_hash) WHERE content_hash IS NOT NULL;
