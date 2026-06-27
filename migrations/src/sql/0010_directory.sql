-- 0010 — directory: profiles, contacts, privacy-preserving discovery (§B3 / §A14.6). Contact
-- discovery never stores raw phone numbers: a user registers a SALTED phone HASH for discoverability,
-- and lookups match uploaded hashes against that set (non-matches are never persisted). §G2 upgrades
-- this to OPRF-PSI; this is the MVP plain-hash form. Expand-only.

CREATE TABLE IF NOT EXISTS profiles (
  user_id              uuid PRIMARY KEY,                 -- = account_id
  display_name         text,
  avatar_media_id      uuid,
  about                text,
  presence_privacy     text NOT NULL DEFAULT 'contacts', -- everyone | contacts | nobody
  lastseen_privacy     text NOT NULL DEFAULT 'contacts',
  readreceipts_enabled boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  user_id         uuid NOT NULL,                         -- owner of the contact list
  contact_user_id uuid NOT NULL,                         -- the resolved account_id
  contact_hash    text,                                  -- salted hash the owner uploaded
  display_name    text,                                  -- owner's local name for the contact
  blocked         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_user_id)
);
CREATE INDEX IF NOT EXISTS contacts_user_idx ON contacts (user_id);

-- Discoverability set: a user opts in by registering a salted phone hash → account_id.
CREATE TABLE IF NOT EXISTS directory_hashes (
  phone_hash text PRIMARY KEY,                           -- salted hash of the E.164 number
  account_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_hashes_account_idx ON directory_hashes (account_id);
