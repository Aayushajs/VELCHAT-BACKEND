-- 0013 — notifications (§B10 / §A19 / §G4). Durable outbox makes push a retryable, deduped, DLQ-backed
-- best-effort HINT; unread/badges truth comes from cursor sync, never the push transport. Mirrors
-- libs/database/src/entities/notification.schema.ts. Expand-only.

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id       uuid NOT NULL,
  scope_type    text NOT NULL,                           -- conversation | channel | global
  scope_id      text NOT NULL,
  level         text NOT NULL DEFAULT 'all',             -- all | mentions | none
  muted_until   timestamptz,
  keywords      text[],
  dnd_schedule  jsonb,                                   -- { tz, from, to }
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS push_endpoints (
  device_id    uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  platform     text NOT NULL,                            -- web | ios | android
  token        text,
  voip_token   text,
  subscription jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_endpoints_user_idx ON push_endpoints (user_id);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  type            text NOT NULL,                         -- message | mention | call | ...
  payload         jsonb NOT NULL,                        -- NO content for E2EE — ids only
  dedupe_key      text NOT NULL,                         -- one push per (event, user)
  status          text NOT NULL DEFAULT 'pending',       -- pending | sent | failed | dead
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_dedupe_idx ON notification_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox (status, next_attempt_at);
