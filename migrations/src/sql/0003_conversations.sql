-- 0003 — conversations + membership (§B7). Channels carry tenant_id (RLS-scoped, §G6);
-- DMs/groups are personal (tenant_id NULL). One service (group-channel) owns these tables (§A10).
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id     text PRIMARY KEY,
  type                text NOT NULL,                  -- dm|group|channel|broadcast|community
  tenant_type         text,                           -- org|workspace (channels)
  tenant_id           text,                           -- NULL for personal
  name                text,
  topic               text,
  avatar_media_id     text,
  visibility          text,                           -- public|private (channels)
  is_announcement     boolean NOT NULL DEFAULT false,
  parent_community_id text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON conversations (tenant_id) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id text NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  role            text NOT NULL DEFAULT 'member',     -- owner|admin|member
  notif_level     text NOT NULL DEFAULT 'all',        -- all|mentions|none
  muted_until     timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_seq   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS communities (
  community_id            text PRIMARY KEY,
  name                    text NOT NULL,
  announcement_channel_id text,
  org_id                  text
);
