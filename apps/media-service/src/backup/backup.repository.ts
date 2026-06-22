import type { PostgresClient } from '@velchat/database';

export interface BackupMeta {
  backup_id: string;
  account_id: string;
  version: number;
  storage_key: string;
  size: number;
  kdf: string;
  salt: string;
  created_at: string;
}

/** E2EE backup metadata (§C21, Postgres). Only ciphertext blobs + non-secret KDF salt are stored. */
export class BackupRepository {
  constructor(private readonly pg: PostgresClient) {}

  async nextVersion(accountId: string): Promise<number> {
    const res = await this.pg.pool.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM e2ee_backups WHERE account_id = $1',
      [accountId],
    );
    return Number((res.rows[0] as { v: string }).v);
  }

  async insert(b: Omit<BackupMeta, 'created_at'>): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO e2ee_backups(backup_id, account_id, version, storage_key, size, kdf, salt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [b.backup_id, b.account_id, b.version, b.storage_key, b.size, b.kdf, b.salt],
    );
  }

  async latest(accountId: string): Promise<BackupMeta | null> {
    const res = await this.pg.pool.query(
      'SELECT * FROM e2ee_backups WHERE account_id = $1 ORDER BY version DESC LIMIT 1',
      [accountId],
    );
    return (res.rows[0] as BackupMeta | undefined) ?? null;
  }
}
