-- 0018 — collaboration Lists (§A4.7): lightweight structured task/tracking lists attached to a
-- channel/DM, owned by automation-service. Mirrors libs/database/src/entities/collab.schema.ts.
-- Expand-only.

CREATE TABLE IF NOT EXISTS lists (
  list_id         uuid PRIMARY KEY,
  conversation_id text NOT NULL,
  title           text NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lists_conversation_idx ON lists (conversation_id);

CREATE TABLE IF NOT EXISTS list_items (
  item_id     uuid PRIMARY KEY,
  list_id     uuid NOT NULL,
  text        text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  assignee    text,
  due_at      timestamptz,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS list_items_list_idx ON list_items (list_id, position);
