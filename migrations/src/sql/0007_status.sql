-- 0007 — status / stories (§B8 / §B14). WhatsApp-grade: text/image/video/voice, audiences, reactions,
-- view-once, viewer list, 24h expiry. Personal status is E2EE — the server stores audience-encrypted
-- ciphertext + the audience set, never plaintext. Expand-only. (Postgres has no TTL index, so reads
-- filter on expires_at and a periodic job purges expired rows.)

CREATE TABLE IF NOT EXISTS status_posts (
  status_id     uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  kind          text NOT NULL,                          -- text|image|video|voice
  media_id      uuid,
  text          text,                                   -- ciphertext for personal (e2ee=true)
  bg            text,
  caption       text,
  audience      jsonb NOT NULL DEFAULT '{"mode":"contacts"}',  -- {mode: contacts|except|only, list:[...]}
  e2ee          boolean NOT NULL DEFAULT true,
  view_once     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL                    -- created_at + 24h
);
CREATE INDEX IF NOT EXISTS status_user_idx ON status_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_expiry_idx ON status_posts (expires_at);

CREATE TABLE IF NOT EXISTS status_views (
  status_id  uuid NOT NULL REFERENCES status_posts(status_id) ON DELETE CASCADE,
  viewer_id  uuid NOT NULL,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS status_reactions (
  status_id  uuid NOT NULL REFERENCES status_posts(status_id) ON DELETE CASCADE,
  viewer_id  uuid NOT NULL,
  emoji      text NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);
