-- 0020 — collaboration Clips + Canvas (§A4.7), owned by automation-service. Clips reference media in
-- media-service; canvas stores a versioned block doc. Mirrors collab.schema.ts. Expand-only.

CREATE TABLE IF NOT EXISTS clips (
  clip_id         uuid PRIMARY KEY,
  conversation_id text NOT NULL,
  media_id        text NOT NULL,
  posted_by       text NOT NULL,
  caption         text,
  duration_sec    integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clips_conversation_idx ON clips (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS canvases (
  canvas_id       uuid PRIMARY KEY,
  conversation_id text NOT NULL,
  title           text NOT NULL,
  content         jsonb NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  created_by      text NOT NULL,
  updated_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS canvases_conversation_idx ON canvases (conversation_id);
