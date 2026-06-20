import { Pool, type PoolClient } from 'pg';
import type { Logger } from 'pino';
import { requireTenant, type ManagedResource } from '@velchat/shared-utils';

/** Postgres client + the §G6 RLS guardrail (set 'app.tenant' GUC per transaction). */
export class PostgresClient implements ManagedResource {
  readonly name = 'postgres';
  readonly pool: Pool;

  constructor(
    connectionString: string,
    max: number,
    private readonly logger: Logger,
  ) {
    this.pool = new Pool({ connectionString, max });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'postgres ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * §G6-1.1: run fn inside a transaction with the RLS GUC set from the active tenant context,
   * so Postgres RLS policies (current_setting('app.tenant')) enforce isolation even if a query
   * forgets its WHERE clause. Missing tenant context → throws (fail-closed).
   */
  async withTenantTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const ctx = requireTenant();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant', $1, true)", [ctx.tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
