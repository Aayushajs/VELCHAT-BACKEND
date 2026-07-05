import type { PostgresClient } from '@velchat/database';
import type { CallScreenControlRow, ScreenControlStatus } from '@velchat/database';
import { uuidv7 } from '@velchat/common';

/** Screen-control data access (§A4.4, Postgres). Parameterized queries. */
export class ScreenControlRepository {
  constructor(private readonly pg: PostgresClient) {}

  /** The current active/requested grant for a call, if any (one at a time). */
  async current(callId: string): Promise<CallScreenControlRow | null> {
    const res = await this.pg.pool.query(
      `SELECT * FROM call_screen_control
       WHERE call_id = $1 AND status IN ('requested','active')
       ORDER BY created_at DESC LIMIT 1`,
      [callId],
    );
    return (res.rows[0] as CallScreenControlRow | undefined) ?? null;
  }

  async getById(id: string): Promise<CallScreenControlRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM call_screen_control WHERE id = $1', [id]);
    return (res.rows[0] as CallScreenControlRow | undefined) ?? null;
  }

  async create(
    callId: string,
    controllerId: string,
    sharerId: string,
  ): Promise<CallScreenControlRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO call_screen_control(id, call_id, controller_id, sharer_id, status)
       VALUES ($1,$2,$3,$4,'requested') RETURNING *`,
      [uuidv7(), callId, controllerId, sharerId],
    );
    return res.rows[0] as CallScreenControlRow;
  }

  async setStatus(id: string, status: ScreenControlStatus): Promise<CallScreenControlRow | null> {
    const res = await this.pg.pool.query(
      `UPDATE call_screen_control SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return (res.rows[0] as CallScreenControlRow | undefined) ?? null;
  }
}
