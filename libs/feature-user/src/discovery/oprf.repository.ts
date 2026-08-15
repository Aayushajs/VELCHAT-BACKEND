import type { PostgresClient } from '@velchat/database';
import type { OprfKeyRow } from '@velchat/database';

/** OPRF key + discoverable-token data access (§G2, Postgres). Parameterized queries. */
export class OprfRepository {
  constructor(private readonly pg: PostgresClient) {}

  async getActiveKey(): Promise<OprfKeyRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM oprf_keys WHERE is_active LIMIT 1');
    return (res.rows[0] as OprfKeyRow | undefined) ?? null;
  }

  async getKeyByVersion(version: number): Promise<OprfKeyRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM oprf_keys WHERE version = $1', [version]);
    return (res.rows[0] as OprfKeyRow | undefined) ?? null;
  }

  /** Insert a new key as the active one, deactivating the previous (rotation, §G2). */
  async insertKey(version: number, n: string, e: string, d: string): Promise<OprfKeyRow> {
    const client = await this.pg.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE oprf_keys SET is_active = false WHERE is_active');
      const res = await client.query(
        `INSERT INTO oprf_keys(version, n, e, d, is_active) VALUES ($1,$2,$3,$4,true) RETURNING *`,
        [version, n, e, d],
      );
      await client.query('COMMIT');
      return res.rows[0] as OprfKeyRow;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async maxVersion(): Promise<number> {
    const res = await this.pg.pool.query('SELECT COALESCE(MAX(version), 0) AS v FROM oprf_keys');
    return Number((res.rows[0] as { v: number | string }).v);
  }

  /** Register (or re-point) a discoverable token for an account — opt-in to discovery. */
  async registerToken(token: string, accountId: string, keyVersion: number): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO oprf_discoverable(token, account_id, key_version) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET account_id = $2, key_version = $3, updated_at = now()`,
      [token, accountId, keyVersion],
    );
  }

  async removeAccountTokens(accountId: string): Promise<void> {
    await this.pg.pool.query('DELETE FROM oprf_discoverable WHERE account_id = $1', [accountId]);
  }

  /** Match uploaded tokens against the discoverable set; non-matches are never stored. */
  async matchTokens(tokens: string[]): Promise<Array<{ token: string; account_id: string }>> {
    if (tokens.length === 0) return [];
    const res = await this.pg.pool.query(
      'SELECT token, account_id FROM oprf_discoverable WHERE token = ANY($1)',
      [tokens],
    );
    return res.rows as Array<{ token: string; account_id: string }>;
  }
}
