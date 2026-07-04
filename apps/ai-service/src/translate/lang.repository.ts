import type { PostgresClient } from '@velchat/database';
import type { UserLanguageRow, ChatTranslatePrefRow } from '@velchat/database';

export interface UserLangPatch {
  uiLang?: string;
  preferredMsgLang?: string | null;
  autoTranslate?: boolean;
  captionLang?: string | null;
  voiceLang?: string | null;
}

/** Language + chat-translate prefs data access (Postgres, §B20). Parameterized upserts. */
export class LangRepository {
  constructor(private readonly pg: PostgresClient) {}

  async getUserLang(accountId: string): Promise<UserLanguageRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM user_language WHERE account_id = $1', [
      accountId,
    ]);
    return (res.rows[0] as UserLanguageRow | undefined) ?? null;
  }

  async upsertUserLang(accountId: string, p: UserLangPatch): Promise<UserLanguageRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO user_language(account_id, ui_lang, preferred_msg_lang, auto_translate, caption_lang, voice_lang)
       VALUES ($1, COALESCE($2,'en'), $3, COALESCE($4,false), $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET
         ui_lang = COALESCE($2, user_language.ui_lang),
         preferred_msg_lang = COALESCE($3, user_language.preferred_msg_lang),
         auto_translate = COALESCE($4, user_language.auto_translate),
         caption_lang = COALESCE($5, user_language.caption_lang),
         voice_lang = COALESCE($6, user_language.voice_lang),
         updated_at = now()
       RETURNING *`,
      [
        accountId,
        p.uiLang ?? null,
        p.preferredMsgLang ?? null,
        p.autoTranslate ?? null,
        p.captionLang ?? null,
        p.voiceLang ?? null,
      ],
    );
    return res.rows[0] as UserLanguageRow;
  }

  async setChatPref(
    accountId: string,
    conversationId: string,
    mode: string,
    targetLang: string | null,
  ): Promise<ChatTranslatePrefRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO chat_translate_pref(account_id, conversation_id, mode, target_lang)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (account_id, conversation_id) DO UPDATE SET
         mode = $3, target_lang = $4, updated_at = now()
       RETURNING *`,
      [accountId, conversationId, mode, targetLang],
    );
    return res.rows[0] as ChatTranslatePrefRow;
  }

  async getChatPref(
    accountId: string,
    conversationId: string,
  ): Promise<ChatTranslatePrefRow | null> {
    const res = await this.pg.pool.query(
      'SELECT * FROM chat_translate_pref WHERE account_id = $1 AND conversation_id = $2',
      [accountId, conversationId],
    );
    return (res.rows[0] as ChatTranslatePrefRow | undefined) ?? null;
  }
}
