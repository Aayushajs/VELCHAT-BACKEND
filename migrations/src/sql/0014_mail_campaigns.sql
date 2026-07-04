-- 0014 — bulk mail campaigns + scheduler (notification-service owns mail/digests, §A19). A campaign
-- is immediate | scheduled | recurring; the worker claims due rows and sends via @velchat/mail, and
-- every per-recipient attempt is logged. Mirrors libs/database/src/entities/mail-campaign.schema.ts.
-- Expand-only.

CREATE TABLE IF NOT EXISTS mail_campaigns (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  subject         text NOT NULL,
  template        text NOT NULL,                          -- welcome | notification | custom
  html            text,
  text            text,
  cta_text        text,
  cta_url         text,
  recipients      jsonb NOT NULL,                         -- string[] of email addresses
  mode            text NOT NULL,                          -- immediate | scheduled | recurring
  scheduled_at    timestamptz,
  recurrence      jsonb,                                  -- { everyDays?, daysOfWeek?[] }
  ends_at         timestamptz,
  max_occurrences integer,
  occurrences     integer NOT NULL DEFAULT 0,
  next_run_at     timestamptz,
  status          text NOT NULL DEFAULT 'active',         -- active | paused | completed | canceled
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_campaigns_due_idx ON mail_campaigns (status, next_run_at);

CREATE TABLE IF NOT EXISTS mail_campaign_sends (
  id          uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  recipient   text NOT NULL,
  run_at      timestamptz NOT NULL,
  status      text NOT NULL,                              -- sent | failed
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_campaign_sends_campaign_idx ON mail_campaign_sends (campaign_id, run_at);
