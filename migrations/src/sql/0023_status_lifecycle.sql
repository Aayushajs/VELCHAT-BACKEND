-- 0023 — status lifecycle. Expand-only.
--
-- 0007 gave status_posts no lifecycle: delete was a hard DELETE that cascaded status_views away
-- (destroying the author's viewer data and any audit trail), and expiry was never actioned because
-- nothing called purgeExpired(). This adds the state a soft delete and a two-stage expiry sweep
-- need.
--
-- Reads filter `state = 'active' AND expires_at > now()`, so expiry and deletion are enforced at
-- READ time and remain correct even if the sweep worker is down. The worker only does cleanup and
-- event emission; it is never load-bearing for correctness.

ALTER TABLE status_posts
  ADD COLUMN IF NOT EXISTS state      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 'creating' | 'processing' | 'failed' are reserved for the Phase 2 media pipeline and are
-- unreachable today; they are in the constraint now so Phase 2 needs no second migration.
ALTER TABLE status_posts
  DROP CONSTRAINT IF EXISTS status_state_chk;
ALTER TABLE status_posts
  ADD CONSTRAINT status_state_chk
  CHECK (state IN ('creating', 'processing', 'active', 'failed', 'deleted', 'expired'));

-- Owner's own list, and the tray candidate scan in Phase 2.
CREATE INDEX IF NOT EXISTS status_owner_active_idx
  ON status_posts (user_id, state, created_at DESC);

-- The expiry sweep's predicate.
CREATE INDEX IF NOT EXISTS status_expiry_sweep_idx
  ON status_posts (state, expires_at);

-- Cursor pagination over the viewer list. The primary key is (status_id, viewer_id), which cannot
-- serve an ordered scan by viewed_at.
CREATE INDEX IF NOT EXISTS status_views_cursor_idx
  ON status_views (status_id, viewed_at);
