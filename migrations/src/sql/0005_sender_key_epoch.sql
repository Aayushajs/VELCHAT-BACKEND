-- 0005 — group sender-key epoch (§G1-2). Expand-only (additive) → safe rollout.
-- Personal groups use Signal Sender Keys: each member encrypts once per group epoch. A membership
-- change rotates the epoch so a removed member can't read new messages and a new member can't read
-- old ones. Clients bind each ciphertext to the epoch and re-distribute sender keys on a bump.
-- Server stays oblivious to key material — it only tracks the epoch number.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sender_key_epoch bigint NOT NULL DEFAULT 1;
