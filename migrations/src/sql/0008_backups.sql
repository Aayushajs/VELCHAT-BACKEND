-- 0008 — E2EE chat backup (§C21). The client bundles its chats + media keys, derives a key from a
-- passphrase / 64-digit recovery key (Argon2id) and uploads CIPHERTEXT. The server stores only the
-- ciphertext blob + metadata (version, size, KDF + salt). The salt is NOT secret — it lets the client
-- re-derive the key on restore; the passphrase/derived key NEVER reaches the server. Lost passphrase
-- = unrecoverable, by design. Expand-only.

CREATE TABLE IF NOT EXISTS e2ee_backups (
  backup_id    uuid PRIMARY KEY,
  account_id   uuid NOT NULL,
  version      bigint NOT NULL,
  storage_key  text NOT NULL,
  size         bigint NOT NULL,
  kdf          text NOT NULL DEFAULT 'argon2id',
  salt         text NOT NULL,                          -- base64; not secret
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, version)
);
CREATE INDEX IF NOT EXISTS e2ee_backups_account_idx ON e2ee_backups (account_id, version DESC);
