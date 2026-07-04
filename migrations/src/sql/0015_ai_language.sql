-- 0015 — language & translation prefs (§B20, ai-service). Server-side translation for ENTERPRISE
-- content only; personal E2EE translation runs on-device (privacy fork §A26.1). A pref is not
-- message content. Mirrors libs/database/src/entities/ai.schema.ts. Expand-only.

CREATE TABLE IF NOT EXISTS user_language (
  account_id         uuid PRIMARY KEY,
  ui_lang            text NOT NULL DEFAULT 'en',
  preferred_msg_lang text,
  auto_translate     boolean NOT NULL DEFAULT false,
  caption_lang       text,
  voice_lang         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_translate_pref (
  account_id      uuid NOT NULL,
  conversation_id text NOT NULL,
  mode            text NOT NULL DEFAULT 'off',   -- off | auto | manual
  target_lang     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, conversation_id)
);
