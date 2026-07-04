import {
  pgTable,
  integer,
  text,
  boolean,
  uniqueIndex,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * OPRF-based private contact discovery (§G2). Server's secret key material + the discoverable-user
 * index, keyed by OPRF token (never a raw or plain-salted hash — see §G2 for why that's brute-forceable).
 */
export const oprfKeys = pgTable(
  'oprf_keys',
  {
    version: integer('version').primaryKey(),
    n: text('n').notNull(),
    e: text('e').notNull(),
    d: text('d').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ oneActive: uniqueIndex('oprf_keys_one_active_idx').on(t.isActive) }),
);

export const oprfDiscoverable = pgTable(
  'oprf_discoverable',
  {
    token: text('token').primaryKey(),
    accountId: text('account_id').notNull(),
    keyVersion: integer('key_version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byAccount: index('oprf_discoverable_account_idx').on(t.accountId) }),
);

export type OprfKeyRow = typeof oprfKeys.$inferSelect;
export type OprfDiscoverableRow = typeof oprfDiscoverable.$inferSelect;
