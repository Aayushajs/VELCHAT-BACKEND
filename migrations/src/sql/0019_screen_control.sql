-- 0019 — screen-share remote control (§A4.4, Teams-style). During a screen share a viewer requests
-- control of the sharer's screen; sharer grants/denies; either can release/revoke. One active grant
-- per call. Signaling only. Mirrors libs/database/src/entities/call.schema.ts. Expand-only.

CREATE TABLE IF NOT EXISTS call_screen_control (
  id            uuid PRIMARY KEY,
  call_id       uuid NOT NULL,
  controller_id uuid NOT NULL,                       -- the viewer requesting/holding control
  sharer_id     uuid NOT NULL,                        -- the screen owner
  status        text NOT NULL DEFAULT 'requested',    -- requested|active|denied|released|revoked
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_screen_control_call_idx ON call_screen_control (call_id, status);
