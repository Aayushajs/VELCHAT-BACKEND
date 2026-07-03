import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

/**
 * call-service schema — calls, participants, meetings (§B12 / §A17). Centralized here (not per
 * service) so every service's DB definition lives in `@velchat/database` (§A10). The media plane
 * (WebRTC/SFU) never touches these tables — only signaling + room/meeting metadata does.
 */

/** A live or scheduled call/room. `roomName` is the LiveKit room the participants connect to. */
export const calls = pgTable('calls', {
  callId: uuid('call_id').primaryKey(),
  type: text('type').notNull(), // 1:1 | group | meeting | huddle
  conversationId: text('conversation_id'), // optional chat this call belongs to
  roomName: text('room_name').notNull(),
  hostId: uuid('host_id').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }), // meetings only
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  lobbyEnabled: boolean('lobby_enabled').notNull().default(false),
  locked: boolean('locked').notNull().default(false),
  recordingEnabled: boolean('recording_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-(call, user) membership + media/state flags (§B12). */
export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('attendee'), // host | cohost | attendee
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    audio: boolean('audio').notNull().default(true),
    video: boolean('video').notNull().default(false),
    screenshare: boolean('screenshare').notNull().default(false),
    handRaised: boolean('hand_raised').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.callId, t.userId] }),
    byCall: index('call_participants_call_idx').on(t.callId),
  }),
);

/** Scheduled meeting metadata (§A17.3) — emits meeting.scheduled → notification + iCal export. */
export const meetings = pgTable('meetings', {
  meetingId: uuid('meeting_id').primaryKey(),
  callId: uuid('call_id').notNull(),
  title: text('title'),
  organizerId: uuid('organizer_id').notNull(),
  invitees: jsonb('invitees'), // account_id[]
  icalUid: text('ical_uid'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CallRow = typeof calls.$inferSelect;
export type CallParticipantRow = typeof callParticipants.$inferSelect;
export type MeetingRow = typeof meetings.$inferSelect;
export type CallType = 'dm' | 'group' | 'meeting' | 'huddle';
export type ParticipantRole = 'host' | 'cohost' | 'attendee';
