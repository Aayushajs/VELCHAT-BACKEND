-- 0004 — versioned device list + key-transparency (§G1-3). Expand-only (additive) → safe rollout.
-- Senders bind E2EE fan-out to the account's device_list_epoch; a ghost-device injection by a
-- compromised server bumps the epoch and is recorded in an append-only, hash-chained log clients
-- can audit (CONIKS-lite). Server alone can never make a device usable — approval is DAPT-gated.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS device_list_epoch bigint NOT NULL DEFAULT 1;

-- Device lifecycle (§G1-3): proposed → attested → approved → active → revoked.
-- Existing rows default to 'active' so the change is backward-compatible.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS key_transparency_log (
  seq               bigserial PRIMARY KEY,            -- global monotonic position
  account_id        uuid NOT NULL REFERENCES accounts(account_id),
  device_id         uuid,                             -- device the action concerns (null for meta)
  action            text NOT NULL,                    -- proposed | approved | revoked
  identity_key_hash text,                             -- sha256(device.signal_identity_key) at bind time
  epoch             bigint NOT NULL,                  -- account device_list_epoch AFTER this action
  prev_hash         text NOT NULL,                    -- previous entry_hash for this account (chain link)
  entry_hash        text NOT NULL,                    -- sha256(prev||account||device||action||idkey||epoch||ts)
  ts                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kt_log_account_idx ON key_transparency_log (account_id, seq);
