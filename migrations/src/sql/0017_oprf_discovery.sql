-- 0017 — OPRF-based private contact discovery (§G2). Expands on 0010_directory.sql; the old
-- `directory_hashes` (salted-hash) path is kept for backward compatibility but is superseded by
-- this OPRF flow, which prevents offline enumeration of the phone-number keyspace: computing a
-- candidate's token requires a live, rate-limited round-trip to the server, and the server never
-- observes the plaintext number (blind RSA signature OPRF). Expand-only.

-- Server's OPRF secret key material (rotatable). Only one row is active at a time.
CREATE TABLE IF NOT EXISTS oprf_keys (
  version    integer PRIMARY KEY,
  n          text NOT NULL,                 -- RSA modulus, base64url big-integer
  e          text NOT NULL,                 -- RSA public exponent, base64url big-integer
  d          text NOT NULL,                 -- RSA private exponent (the OPRF secret), base64url
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one active key at a time (rotation flips the old one inactive in the same transaction).
CREATE UNIQUE INDEX IF NOT EXISTS oprf_keys_one_active_idx ON oprf_keys (is_active) WHERE is_active;

-- Discoverable users, indexed by OPRF token (never a raw or salted-only hash of the number).
CREATE TABLE IF NOT EXISTS oprf_discoverable (
  token        text PRIMARY KEY,            -- sha256(unblind(evaluate(blind(number)))), hex
  account_id   uuid NOT NULL,
  key_version  integer NOT NULL,            -- which oprf_keys.version produced this token
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oprf_discoverable_account_idx ON oprf_discoverable (account_id);
