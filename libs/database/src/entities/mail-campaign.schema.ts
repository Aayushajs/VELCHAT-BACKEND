import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';

/**
 * Bulk mail campaigns + scheduler (owned by notification-service — it owns mail/digests, §A19).
 * A campaign is one of: immediate (send now), scheduled (send at a date), or recurring (send on a
 * cadence until an end date / max occurrences). The worker claims due campaigns and sends via the
 * shared @velchat/mail mailer; every per-recipient attempt is logged for idempotency + tracking.
 */
export const mailCampaigns = pgTable(
  'mail_campaigns',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    template: text('template').notNull(), // welcome | notification | custom
    html: text('html'), // custom template body
    text: text('text'), // custom/notification body text
    ctaText: text('cta_text'),
    ctaUrl: text('cta_url'),
    recipients: jsonb('recipients').notNull(), // string[] of email addresses
    mode: text('mode').notNull(), // immediate | scheduled | recurring
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    recurrence: jsonb('recurrence'), // { everyDays?: number, daysOfWeek?: number[] }
    endsAt: timestamp('ends_at', { withTimezone: true }),
    maxOccurrences: integer('max_occurrences'),
    occurrences: integer('occurrences').notNull().default(0),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    status: text('status').notNull().default('active'), // active | paused | completed | canceled
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ due: index('mail_campaigns_due_idx').on(t.status, t.nextRunAt) }),
);

/** Per-recipient send log — one row per (campaign, recipient, run) for tracking + idempotency. */
export const mailCampaignSends = pgTable(
  'mail_campaign_sends',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id').notNull(),
    recipient: text('recipient').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(), // sent | failed
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byCampaign: index('mail_campaign_sends_campaign_idx').on(t.campaignId, t.runAt) }),
);

export type MailCampaignRow = typeof mailCampaigns.$inferSelect;
export type MailCampaignSendRow = typeof mailCampaignSends.$inferSelect;
export type CampaignMode = 'immediate' | 'scheduled' | 'recurring';
export type CampaignStatus = 'active' | 'paused' | 'completed' | 'canceled';
export type CampaignTemplate = 'welcome' | 'notification' | 'custom';
export interface CampaignRecurrence {
  everyDays?: number;
  daysOfWeek?: number[];
}
