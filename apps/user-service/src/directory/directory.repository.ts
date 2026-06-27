import type { PostgresClient } from '@velchat/database';

export interface Profile {
  user_id: string;
  display_name: string | null;
  avatar_media_id: string | null;
  about: string | null;
  presence_privacy: string;
  lastseen_privacy: string;
  readreceipts_enabled: boolean;
}

export interface ProfilePatch {
  displayName?: string;
  avatarMediaId?: string;
  about?: string;
  presencePrivacy?: string;
  lastseenPrivacy?: string;
  readreceiptsEnabled?: boolean;
}

export interface Contact {
  contact_user_id: string;
  display_name: string | null;
  blocked: boolean;
}

/** Profiles, contacts, discovery (§B3, Postgres). Raw phone numbers are never stored — only hashes. */
export class DirectoryRepository {
  constructor(private readonly pg: PostgresClient) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const res = await this.pg.pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
    return (res.rows[0] as Profile | undefined) ?? null;
  }

  /** Upsert + patch only the provided fields (COALESCE keeps existing values). */
  async upsertProfile(userId: string, p: ProfilePatch): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO profiles(user_id, display_name, avatar_media_id, about, presence_privacy, lastseen_privacy, readreceipts_enabled)
       VALUES ($1, $2, $3, $4, COALESCE($5,'contacts'), COALESCE($6,'contacts'), COALESCE($7,true))
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = COALESCE($2, profiles.display_name),
         avatar_media_id = COALESCE($3, profiles.avatar_media_id),
         about = COALESCE($4, profiles.about),
         presence_privacy = COALESCE($5, profiles.presence_privacy),
         lastseen_privacy = COALESCE($6, profiles.lastseen_privacy),
         readreceipts_enabled = COALESCE($7, profiles.readreceipts_enabled),
         updated_at = now()`,
      [
        userId,
        p.displayName ?? null,
        p.avatarMediaId ?? null,
        p.about ?? null,
        p.presencePrivacy ?? null,
        p.lastseenPrivacy ?? null,
        p.readreceiptsEnabled ?? null,
      ],
    );
  }

  async addContact(
    userId: string,
    contactUserId: string,
    displayName: string | null,
    contactHash: string | null,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO contacts(user_id, contact_user_id, display_name, contact_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, contact_user_id) DO UPDATE SET display_name = COALESCE($3, contacts.display_name)`,
      [userId, contactUserId, displayName, contactHash],
    );
  }

  async setBlocked(userId: string, contactUserId: string, blocked: boolean): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO contacts(user_id, contact_user_id, blocked) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, contact_user_id) DO UPDATE SET blocked = $3`,
      [userId, contactUserId, blocked],
    );
  }

  async isBlocked(userId: string, contactUserId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      'SELECT blocked FROM contacts WHERE user_id = $1 AND contact_user_id = $2',
      [userId, contactUserId],
    );
    return (res.rows[0] as { blocked: boolean } | undefined)?.blocked ?? false;
  }

  async listContacts(userId: string): Promise<Contact[]> {
    const res = await this.pg.pool.query(
      'SELECT contact_user_id, display_name, blocked FROM contacts WHERE user_id = $1',
      [userId],
    );
    return res.rows as Contact[];
  }

  // ── Privacy-preserving discovery (§A14.6) ──
  async registerHash(accountId: string, phoneHash: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO directory_hashes(phone_hash, account_id) VALUES ($1, $2)
       ON CONFLICT (phone_hash) DO UPDATE SET account_id = $2, updated_at = now()`,
      [phoneHash, accountId],
    );
  }

  /** Match uploaded hashes against the discoverable set; non-matches are never stored. */
  async matchHashes(hashes: string[]): Promise<Array<{ phone_hash: string; account_id: string }>> {
    if (hashes.length === 0) return [];
    const res = await this.pg.pool.query(
      'SELECT phone_hash, account_id FROM directory_hashes WHERE phone_hash = ANY($1)',
      [hashes],
    );
    return res.rows as Array<{ phone_hash: string; account_id: string }>;
  }
}
