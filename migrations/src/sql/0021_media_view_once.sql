-- 0021 — view-once consumption marker for media (§C22). One successful fetch then 410 Gone:
-- `consume` sets viewed_at atomically (WHERE viewed_at IS NULL), so a replay finds it already set.
-- Expand-only (nullable column, safe on a rolling deploy).

ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

-- Gallery reads: list a conversation's ready media newest-first.
CREATE INDEX IF NOT EXISTS media_conversation_idx
  ON media_objects (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;
