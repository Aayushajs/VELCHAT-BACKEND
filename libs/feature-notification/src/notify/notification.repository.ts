import { timingSafeEqual } from 'node:crypto';
import type { PostgresClient } from '@velchat/database';
import type { NotificationPrefRow, PushEndpointRow, OutboxRow } from '@velchat/database';

export interface PrefPatch {
  level?: string;
  mutedUntil?: Date | null;
  keywords?: string[];
  dndSchedule?: unknown;
}

/**
 * Raw `pg` results carry DATABASE column names — snake_case. The row types used here are
 * drizzle's inferred ones, which are camelCase. A `res.rows as OutboxRow[]` cast bridges those
 * two with nothing but a promise, and the compiler accepts it because a cast through `unknown`
 * always type-checks.
 *
 * That promise was false, and it cost every push in the system. `claimPending` returned rows
 * whose `userId` was `undefined`; the worker then asked for the endpoints of nobody, got none,
 * and marked the row `sent` under the comment "no device to push to". Postgres said delivered,
 * the outbox said delivered, nothing was logged anywhere — and FCM was never called at all.
 *
 * So the translation lives here, in the one place that knows both spellings, and every method
 * returns rows that genuinely match the type on its signature. The camelCase fallbacks are for a
 * caller that hands us already-mapped rows (drizzle, or a test), which makes this a
 * normalisation rather than a second guess about the driver.
 */
function toOutboxRow(r: Record<string, unknown>): OutboxRow {
  return {
    id: r.id as OutboxRow['id'],
    userId: (r.user_id ?? r.userId) as OutboxRow['userId'],
    type: r.type as OutboxRow['type'],
    payload: r.payload as OutboxRow['payload'],
    dedupeKey: (r.dedupe_key ?? r.dedupeKey) as OutboxRow['dedupeKey'],
    status: r.status as OutboxRow['status'],
    attempts: r.attempts as OutboxRow['attempts'],
    nextAttemptAt: (r.next_attempt_at ?? r.nextAttemptAt) as OutboxRow['nextAttemptAt'],
    lastError: (r.last_error ?? r.lastError ?? null) as OutboxRow['lastError'],
    createdAt: (r.created_at ?? r.createdAt) as OutboxRow['createdAt'],
  };
}

function toPushEndpointRow(r: Record<string, unknown>): PushEndpointRow {
  return {
    deviceId: (r.device_id ?? r.deviceId) as PushEndpointRow['deviceId'],
    userId: (r.user_id ?? r.userId) as PushEndpointRow['userId'],
    platform: r.platform as PushEndpointRow['platform'],
    token: (r.token ?? null) as PushEndpointRow['token'],
    voipToken: (r.voip_token ?? r.voipToken ?? null) as PushEndpointRow['voipToken'],
    subscription: (r.subscription ?? null) as PushEndpointRow['subscription'],
    updatedAt: (r.updated_at ?? r.updatedAt) as PushEndpointRow['updatedAt'],
  };
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

  /**
   * Resolve the owner of a push endpoint by proving possession of its token (see `push-ack.ts`).
   *
   * The token is compared in Node with `timingSafeEqual`, not in SQL. A `WHERE token = $2` would
   * work, but this endpoint is reachable without a JWT, so the comparison is the whole
   * authentication step — doing it in constant time removes the question rather than arguing
   * about how exploitable a database string compare is.
   *
   * Returns null for an unknown device, a device with no token stored, or a token mismatch. The
   * caller must not distinguish those three: they are all "not this device".
   */
  async accountForPushToken(deviceId: string, token: string): Promise<string | null> {
    let res;
    try {
      res = await this.pg.pool.query(
        'SELECT user_id, token FROM push_endpoints WHERE device_id = $1',
        [deviceId],
      );
    } catch {
      // `push_endpoints.device_id` is a uuid column, so a device id that is not a uuid makes
      // Postgres reject the QUERY rather than return zero rows. On this endpoint — which is
      // reachable without a JWT — that surfaced as a 500 instead of the 401 it should be, and a
      // 500 on an unauthenticated route is both a worse error and a louder signal to a prober.
      // Swallowing it keeps all failure modes indistinguishable: "not this device".
      return null;
    }
    const row = res.rows[0] as { user_id: string; token: string | null } | undefined;
    if (!row?.token) return null;
    const a = Buffer.from(row.token, 'utf8');
    const b = Buffer.from(token, 'utf8');
    if (a.length !== b.length) return null; // timingSafeEqual throws on a length mismatch
    return timingSafeEqual(a, b) ? row.user_id : null;
  }

  async endpointsFor(userId: string): Promise<PushEndpointRow[]> {
    const res = await this.pg.pool.query('SELECT * FROM push_endpoints WHERE user_id = $1', [
      userId,
    ]);
    return res.rows.map((r) => toPushEndpointRow(r as Record<string, unknown>));
  }

  /**
   * Remove an endpoint the push provider has told us is permanently invalid (FCM `UNREGISTERED`,
   * Web Push 410 Gone).
   *
   * Pruning is not housekeeping, it is correctness. Every sign-out deletes the FCM token and the
   * next login provisions a NEW device id, so stale rows accumulate one per login — and each one
   * fails every future notification for that user. FCM's own guidance is to delete on these
   * responses rather than keep paying for them.
   */
  async deleteEndpoint(deviceId: string): Promise<void> {
    await this.pg.pool.query('DELETE FROM push_endpoints WHERE device_id = $1', [deviceId]);
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
    return res.rows.map((r) => toOutboxRow(r as Record<string, unknown>));
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
