import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * automation-service schema (§B17 / §A4.7): bots, slash commands, workflows, outbound webhooks, and a
 * durable job runner (reminders, webhook deliveries, workflow steps) with retry/backoff + DLQ.
 */

/** A bot user with scopes + a webhook the platform POSTs (HMAC-signed) to. Token is hashed-at-rest. */
export const bots = pgTable('bots', {
  botId: uuid('bot_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret').notNull(), // HMAC secret for signing dispatch payloads
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A slash command (`/poll`, `/remind`, custom) routed to a bot within a workspace. */
export const slashCommands = pgTable(
  'slash_commands',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    command: text('command').notNull(), // without the leading slash
    botId: uuid('bot_id').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uq: uniqueIndex('slash_commands_ws_cmd_idx').on(t.workspaceId, t.command) }),
);

/** A no-code workflow: trigger → ordered steps. Steps run durably via the job runner. */
export const workflows = pgTable('workflows', {
  workflowId: uuid('workflow_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  trigger: jsonb('trigger').notNull(), // { type: 'manual'|'keyword'|'schedule', ... }
  steps: jsonb('steps').notNull(), // [{ type:'webhook'|'emit_event'|'delay', ... }]
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Outbound webhook subscription for a bot (event-filtered, HMAC-signed on delivery). */
export const webhooksOutbound = pgTable('webhooks_outbound', {
  id: uuid('id').primaryKey(),
  botId: uuid('bot_id').notNull(),
  eventFilter: text('event_filter').notNull(), // topic/glob to match
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Durable job queue (§B17): reminders, webhook deliveries, workflow steps. Retry + backoff + DLQ. */
export const automationJobs = pgTable(
  'automation_jobs',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(), // reminder | webhook | workflow_step
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // pending | done | failed | dead
    attempts: integer('attempts').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ due: index('automation_jobs_due_idx').on(t.status, t.runAt) }),
);

export type BotRow = typeof bots.$inferSelect;
export type SlashCommandRow = typeof slashCommands.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type WebhookOutboundRow = typeof webhooksOutbound.$inferSelect;
export type AutomationJobRow = typeof automationJobs.$inferSelect;
export type JobKind = 'reminder' | 'webhook' | 'workflow_step';
