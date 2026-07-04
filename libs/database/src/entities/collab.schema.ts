import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';

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

export type ListRow = typeof lists.$inferSelect;
export type ListItemRow = typeof listItems.$inferSelect;
