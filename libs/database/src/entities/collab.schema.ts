import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Collaboration surfaces (§A4.7): Lists (lightweight structured task/tracking lists attached to a
 * channel/DM). Owned by automation-service. Canvas + Clips land as follow-ups.
 */
export const lists = pgTable(
  'lists',
  {
    listId: uuid('list_id').primaryKey(),
    conversationId: text('conversation_id').notNull(), // channel/DM the list is attached to
    title: text('title').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byConversation: index('lists_conversation_idx').on(t.conversationId) }),
);

export const listItems = pgTable(
  'list_items',
  {
    itemId: uuid('item_id').primaryKey(),
    listId: uuid('list_id').notNull(),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    assignee: text('assignee'), // account_id, optional
    dueAt: timestamp('due_at', { withTimezone: true }),
    position: integer('position').notNull().default(0), // ordering within the list
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byList: index('list_items_list_idx').on(t.listId, t.position) }),
);

/** Clips (§A4.7): short async audio/video recordings posted to a channel/DM. The media itself lives
 * in media-service; a clip just references its `media_id` + a caption/duration. */
export const clips = pgTable(
  'clips',
  {
    clipId: uuid('clip_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    mediaId: text('media_id').notNull(),
    postedBy: text('posted_by').notNull(),
    caption: text('caption'),
    durationSec: integer('duration_sec'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byConversation: index('clips_conversation_idx').on(t.conversationId, t.createdAt) }),
);

/** Canvas (§A4.7): a collaborative doc attached to a channel/DM. `content` is a block array; `version`
 * gives optimistic concurrency (real-time co-editing / CRDT merge is a client concern). */
export const canvases = pgTable(
  'canvases',
  {
    canvasId: uuid('canvas_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    title: text('title').notNull(),
    content: jsonb('content').notNull(), // block array
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byConversation: index('canvases_conversation_idx').on(t.conversationId) }),
);

export type ListRow = typeof lists.$inferSelect;
export type ListItemRow = typeof listItems.$inferSelect;
export type ClipRow = typeof clips.$inferSelect;
export type CanvasRow = typeof canvases.$inferSelect;
