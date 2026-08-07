-- 0022 — Contact sync (§contact-sync design). Reverse index of "who has whom as a contact",
-- keyed by the OPRF token (NEVER the plaintext number), so when someone registers we can notify
-- exactly the owners who already hold their number — no full re-scan on any client. Expand-only.

CREATE TABLE IF NOT EXISTS contact_edges (
  owner_id    uuid   NOT NULL,        -- the user who has this contact in their address book
  peer_token  text   NOT NULL,        -- OPRF token of that contact's number (opaque, not reversible)
  peer_id     uuid,                    -- resolved account_id once the number is on VelChat (else null)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, peer_token)
);

-- "who holds THIS token?" — the fan-out lookup when a number registers.
CREATE INDEX IF NOT EXISTS contact_edges_token_idx ON contact_edges (peer_token);
-- "who has ME as a contact?" — reverse traversal by resolved account.
CREATE INDEX IF NOT EXISTS contact_edges_peer_idx  ON contact_edges (peer_id) WHERE peer_id IS NOT NULL;
