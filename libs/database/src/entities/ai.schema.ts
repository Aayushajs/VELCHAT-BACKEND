import { pgTable, uuid, text, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Language & translation prefs (§B20). Owned by ai-service. The PRIVACY FORK (§A26.1): these prefs
 * drive server-side translation for ENTERPRISE (server-readable) content only; personal E2EE content
 * is translated ON-DEVICE (the server never sees that plaintext). Storing prefs here is fine — a
 * pref is not message content.
 */
export const userLanguage = pgTable('user_language', {
  accountId: uuid('account_id').primaryKey(),
  uiLang: text('ui_lang').notNull().default('en'),
  preferredMsgLang: text('preferred_msg_lang'),
  autoTranslate: boolean('auto_translate').notNull().default(false),
  captionLang: text('caption_lang'),
  voiceLang: text('voice_lang'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-(account, conversation) translation mode: off | auto | manual, with a target language. */
export const chatTranslatePref = pgTable(
  'chat_translate_pref',
  {
    accountId: uuid('account_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    mode: text('mode').notNull().default('off'), // off | auto | manual
    targetLang: text('target_lang'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.accountId, t.conversationId] }) }),
);

export type UserLanguageRow = typeof userLanguage.$inferSelect;
export type ChatTranslatePrefRow = typeof chatTranslatePref.$inferSelect;
export type TranslateMode = 'off' | 'auto' | 'manual';
