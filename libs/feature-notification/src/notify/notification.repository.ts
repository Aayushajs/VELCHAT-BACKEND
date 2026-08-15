import type { PostgresClient } from '@velchat/database';
import type { NotificationPrefRow, PushEndpointRow, OutboxRow } from '@velchat/database';

export interface PrefPatch {
  level?: string;
  mutedUntil?: Date | null;
  keywords?: string[];
  dndSchedule?: unknown;
}

/** notification data access (§B10, Postgres). Prefs, device endpoints, and the durable outbox. */
export class NotificationRepository {
  constructor(private readonly pg: PostgresClient) {}

  async getPref(
    userId: string,
    scopeType: string,
    scopeId: string,
  ): Promise<NotificationPrefRow | null> {
    const res = await this.pg.pool.query(
      'SELECT * FROM notification_prefs WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3',
      [userId, scopeType, scopeId],
    );
    return (res.rows[0] as NotificationPrefRow | undefined) ?? null;
  }

  async upsertPref(
    userId: string,
    scopeType: string,
    scopeId: string,
    p: PrefPatch,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO notification_prefs(user_id, scope_type, scope_id, level, muted_until, keywords, dnd_schedule)
       VALUES ($1, $2, $3, COALESCE($4,'all'), $5, $6, $7)
       ON CONFLICT (user_id, scope_type, scope_id) DO UPDATE SET
         level = COALESCE($4, notification_prefs.level),
         muted_until = $5,
         keywords = COALESCE($6, notification_prefs.keywords),
         dnd_schedule = COALESCE($7, notification_prefs.dnd_schedule),
         updated_at = now()`,
      [
        userId,
        scopeType,
        scopeId,
        p.level ?? null,
        p.mutedUntil ?? null,
        p.keywords ?? null,
        p.dndSchedule ? JSON.stringify(p.dndSchedule) : null,
      ],
    );
  }

  async registerEndpoint(e: {
    deviceId: string;
    userId: string;
    platform: string;
    token?: string;
    voipToken?: string;
    subscription?: unknown;
  }): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO push_endpoints(device_id, user_id, platform, token, voip_token, subscription)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (device_id) DO UPDATE SET
         user_id = $2, platform = $3, token = $4, voip_token = $5, subscription = $6, updated_at = now()`,
      [
        e.deviceId,
        e.userId,
        e.platform,
        e.token ?? null,
        e.voipToken ?? null,
        e.subscription ? JSON.stringify(e.subscription) : null,
      ],
    );
  }

  async endpointsFor(userId: string): Promise<PushEndpointRow[]> {
    const res = await this.pg.pool.query('SELECT * FROM push_endpoints WHERE user_id = $1', [
      userId,
    ]);
    return res.rows as PushEndpointRow[];
  }

  /** Enqueue a push idempotently — the unique dedupeKey means one push per (event, user). */
  async enqueue(o: {
    id: string;
    userId: string;
    type: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    const res = await this.pg.pool.query(
      `INSERT INTO notification_outbox(id, user_id, type, payload, dedupe_key)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING`,
      [o.id, o.userId, o.type, JSON.stringify(o.payload), o.dedupeKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Claim a batch of due pending rows (FOR UPDATE SKIP LOCKED — safe across worker replicas). */
  async claimPending(limit: number): Promise<OutboxRow[]> {
    const res = await this.pg.pool.query(
      `UPDATE notification_outbox SET attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM notification_outbox
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [limit],
    );
    return res.rows as OutboxRow[];
  }

  async markSent(id: string): Promise<void> {
    await this.pg.pool.query("UPDATE notification_outbox SET status = 'sent' WHERE id = $1", [id]);
  }

  /** Backoff for a retry, or move to the DLQ (`dead`) once attempts exceed the cap. */
  async markRetryOrDead(
    id: string,
    attempts: number,
    maxAttempts: number,
    error: string,
  ): Promise<void> {
    if (attempts >= maxAttempts) {
      await this.pg.pool.query(
        "UPDATE notification_outbox SET status = 'dead', last_error = $2 WHERE id = $1",
        [id, error.slice(0, 500)],
      );
      return;
    }
    const backoffSec = Math.min(3600, 2 ** attempts * 10); // 20s,40s,80s… capped 1h
    await this.pg.pool.query(
      `UPDATE notification_outbox SET status = 'pending', last_error = $2,
         next_attempt_at = now() + ($3 || ' seconds')::interval WHERE id = $1`,
      [id, error.slice(0, 500), String(backoffSec)],
    );
  }
}
