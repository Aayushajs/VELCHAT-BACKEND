-- 0016 — automation-service (§B17 / §A4.7): bots, slash commands, workflows, outbound webhooks, and a
-- durable job runner (reminders, webhook deliveries, workflow steps) with retry/backoff + DLQ.
-- Mirrors libs/database/src/entities/automation.schema.ts. Expand-only.

CREATE TABLE IF NOT EXISTS bots (
  bot_id         uuid PRIMARY KEY,
  workspace_id   text NOT NULL,
  name           text NOT NULL,
  token_hash     text NOT NULL,
  scopes         text[] NOT NULL DEFAULT '{}',
  webhook_url    text,
  webhook_secret text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slash_commands (
  id           uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  command      text NOT NULL,
  bot_id       uuid NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS slash_commands_ws_cmd_idx ON slash_commands (workspace_id, command);

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id  uuid PRIMARY KEY,
  workspace_id text NOT NULL,
  name         text NOT NULL,
  trigger      jsonb NOT NULL,
  steps        jsonb NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhooks_outbound (
  id           uuid PRIMARY KEY,
  bot_id       uuid NOT NULL,
  event_filter text NOT NULL,
  url          text NOT NULL,
  secret       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,                        -- reminder | webhook | workflow_step
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending',      -- pending | done | failed | dead
  attempts    integer NOT NULL DEFAULT 0,
  run_at      timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_jobs_due_idx ON automation_jobs (status, run_at);
