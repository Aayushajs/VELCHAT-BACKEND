-- 0001 — auth-service schema (§B2.1). Identity tables are GLOBAL (not tenant-scoped) → no RLS.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  account_id     uuid PRIMARY KEY,                       -- UUIDv7, app-generated
  status         text NOT NULL DEFAULT 'active',         -- active|limited|locked|dormant|deleted
  tier           text NOT NULL DEFAULT 'limited',        -- full(phone-verified) | limited
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(account_id),
  kind        text NOT NULL,                             -- phone | email
  value_norm  text NOT NULL,                             -- E.164 phone / normalized email
  value_hash  text NOT NULL,                             -- contact discovery / lookup
  verified_at timestamptz,
  is_primary  boolean NOT NULL DEFAULT false
);
-- 1 verified number/email = 1 account
CREATE UNIQUE INDEX IF NOT EXISTS identifiers_verified_unique
  ON identifiers (kind, value_norm) WHERE verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS identifiers_account_idx ON identifiers (account_id);
CREATE INDEX IF NOT EXISTS identifiers_hash_idx ON identifiers (value_hash);

CREATE TABLE IF NOT EXISTS devices (
  device_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(account_id),
  platform            text NOT NULL,                     -- ios|android|web|desktop
  device_pubkey       bytea NOT NULL,                    -- DAPT device key (private key in enclave)
  attestation         jsonb,                             -- Play Integrity / App Attest verdict
  display_name        text,
  push_token          text,
  signal_identity_key bytea,                             -- Signal/E2EE identity
  trusted             boolean NOT NULL DEFAULT false,    -- can approve new devices
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);
CREATE INDEX IF NOT EXISTS devices_account_idx ON devices (account_id);

CREATE TABLE IF NOT EXISTS passkeys (
  cred_id    bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  aaguid     bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  uuid NOT NULL REFERENCES devices(device_id),
  token_hash text NOT NULL,
  family_id  uuid NOT NULL,                              -- rotation family (reuse detection)
  cnf_jkt    text,                                       -- DPoP key thumbprint → device-bound
  expires_at timestamptz NOT NULL,
  revoked    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS signal_prekeys (
  device_id         uuid PRIMARY KEY REFERENCES devices(device_id),
  signed_prekey     bytea NOT NULL,
  signed_prekey_sig bytea NOT NULL,
  one_time_prekeys  jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS totp_secrets (
  account_id uuid PRIMARY KEY REFERENCES accounts(account_id),
  secret_enc bytea NOT NULL,
  enabled    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS recovery_backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  code_hash  text NOT NULL,
  used       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS recovery_codes_account_idx ON recovery_backup_codes (account_id);

CREATE TABLE IF NOT EXISTS auth_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid,
  event      text NOT NULL,
  ip         text,
  device_id  uuid,
  risk_score text,
  ts         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_audit_account_idx ON auth_audit (account_id, ts);
