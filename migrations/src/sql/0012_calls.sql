-- 0012 — calls & meetings (§B12 / §A17). Signaling + room/meeting metadata only; the media plane
-- (WebRTC → coturn → LiveKit SFU) never touches the DB. Mirrors libs/database/src/entities/call.schema.ts.
-- Expand-only.

CREATE TABLE IF NOT EXISTS calls (
  call_id           uuid PRIMARY KEY,
  type              text NOT NULL,                       -- dm | group | meeting | huddle
  conversation_id   text,
  room_name         text NOT NULL,                       -- LiveKit room
  host_id           uuid NOT NULL,
  scheduled_at      timestamptz,                         -- meetings only
  started_at        timestamptz,
  ended_at          timestamptz,
  lobby_enabled     boolean NOT NULL DEFAULT false,
  locked            boolean NOT NULL DEFAULT false,
  recording_enabled boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_conversation_idx ON calls (conversation_id);

CREATE TABLE IF NOT EXISTS call_participants (
  call_id      uuid NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  role         text NOT NULL DEFAULT 'attendee',         -- host | cohost | attendee
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  audio        boolean NOT NULL DEFAULT true,
  video        boolean NOT NULL DEFAULT false,
  screenshare  boolean NOT NULL DEFAULT false,
  hand_raised  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX IF NOT EXISTS call_participants_call_idx ON call_participants (call_id);

CREATE TABLE IF NOT EXISTS meetings (
  meeting_id   uuid PRIMARY KEY,
  call_id      uuid NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  title        text,
  organizer_id uuid NOT NULL,
  invitees     jsonb,
  ical_uid     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
