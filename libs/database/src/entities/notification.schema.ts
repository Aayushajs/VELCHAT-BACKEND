import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * notification-service schema (§B10 / §A19 / §G4). Centralized here (DB definitions live in
 * @velchat/database). The outbox makes push a durable, retryable, deduped best-effort HINT — the
 * source of truth for unread/badges is always cursor sync (§G4), never the push transport.
 */

/** Per-(user, scope) delivery prefs — level, mute, DND window, keyword alerts. */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: uuid('user_id').notNull(),
    scopeType: text('scope_type').notNull(), // conversation | channel | global
    scopeId: text('scope_id').notNull(),
    level: text('level').notNull().default('all'), // all | mentions | none
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    keywords: text('keywords').array(),
    dndSchedule: jsonb('dnd_schedule'), // { tz, from: "22:00", to: "07:00" }
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.scopeType, t.scopeId] }) }),
);

/** A device's push transport handle (§B10). Mobile → token; web → VAPID subscription. */
export const pushEndpoints = pgTable(
  'push_endpoints',
  {
    deviceId: uuid('device_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    platform: text('platform').notNull(), // web | ios | android
    token: text('token'), // FCM/APNs token
    voipToken: text('voip_token'), // CallKit/ConnectionService VoIP token
    subscription: jsonb('subscription'), // Web Push subscription {endpoint, keys}
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUser: index('push_endpoints_user_idx').on(t.userId) }),
);

/** Durable push outbox (§G4): retry + backoff + idempotency (dedupeKey) + DLQ (status=dead). */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(), // message | mention | call | ...
    payload: jsonb('payload').notNull(), // NO content for E2EE — ids only
    dedupeKey: text('dedupe_key').notNull(), // e.g. `${message_id}:${user_id}` — one push per event/user
    status: text('status').notNull().default('pending'), // pending | sent | failed | dead
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupe: uniqueIndex('notification_outbox_dedupe_idx').on(t.dedupeKey),
    pending: index('notification_outbox_pending_idx').on(t.status, t.nextAttemptAt),
  }),
);

export type NotificationPrefRow = typeof notificationPrefs.$inferSelect;
export type PushEndpointRow = typeof pushEndpoints.$inferSelect;
export type OutboxRow = typeof notificationOutbox.$inferSelect;
export type NotifyLevel = 'all' | 'mentions' | 'none';
