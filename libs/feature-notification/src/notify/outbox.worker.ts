import type { Logger } from '@velchat/common';
import type { PushSender, PushTarget, WebPushSubscription } from '@velchat/push';
import { PushSendError } from '@velchat/push';
import type { PushEndpointRow } from '@velchat/database';
import { NotificationRepository } from './notification.repository';

const MAX_ATTEMPTS = 6;

/**
 * Durable push delivery worker (§G4). Polls the outbox for due rows (claimed with FOR UPDATE SKIP
 * LOCKED so replicas don't double-send), fans each to the user's device endpoints via the push
 * sender, and marks sent / retries with backoff / moves to the DLQ. A user with no endpoints is a
 * no-op success (nothing to deliver) — the message is still there via cursor sync.
 */
export class OutboxWorker {
  private timer?: ReturnType<typeof setInterval>;
  /** True while a tick is in flight, so `kick()` cannot overlap the timer's own pass. */
  private ticking = false;

  constructor(
    private readonly repo: NotificationRepository,
    private readonly push: PushSender,
    private readonly logger: Logger,
    private readonly intervalMs = 2000,
    private readonly batch = 50,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Deliver NOW, rather than at the next poll.
   *
   * The timer is a safety net for rows this misses (a crash between enqueue and kick, a retry
   * coming due); it should not be how a notification is normally sent. Waiting for it added up to
   * `intervalMs` of dead time to every push — on a chat app, seconds of latency the user reads as
   * "the notification did not arrive", because by the time it lands they have already opened the
   * app to check.
   *
   * Never throws and never awaits the caller: the enqueue must not be able to fail because a
   * delivery attempt did.
   */
  kick(): void {
    if (this.ticking) return;
    void this.tick();
  }

  /** One delivery pass — exported for tests + the interval. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runTick();
    } finally {
      this.ticking = false;
    }
  }

  private async runTick(): Promise<void> {
    let rows;
    try {
      rows = await this.repo.claimPending(this.batch);
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'outbox claim failed (db not ready?)');
      return;
    }
    for (const row of rows) {
      const endpoints = await this.repo.endpointsFor(row.userId);
      if (endpoints.length === 0) {
        await this.repo.markSent(row.id); // no device to push to → nothing to do
        continue;
      }
      const data = stringifyValues(row.payload as Record<string, unknown>);
      // Per endpoint, INDEPENDENTLY. `Promise.all` failed the whole row as soon as any single
      // device failed — and because the sends run in parallel, the devices that DID receive it
      // got the notification again on every retry. One stale token (a sign-out leaves one behind
      // per login) was therefore enough to turn every message into a stream of duplicates on the
      // user's live phone, and then bury the row in the DLQ.
      const results = await Promise.allSettled(
        endpoints.map((e) => this.push.send(toTarget(e), { type: row.type, data })),
      );

      let delivered = 0;
      let retryable = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const endpoint = endpoints[i];
        if (!r || !endpoint) continue;
        if (r.status === 'fulfilled') {
          delivered++;
          continue;
        }
        const err = r.reason as unknown;
        if (err instanceof PushSendError && err.gone) {
          // Never coming back. Drop it so it stops failing every future notification.
          const deviceId = deviceIdOf(endpoint);
          if (!deviceId) {
            this.logger.warn('push endpoint gone but its id is unreadable — not pruning');
            continue;
          }
          try {
            await this.repo.deleteEndpoint(deviceId);
            this.logger.info(
              { deviceId, status: err.status },
              'push endpoint pruned (provider says gone)',
            );
          } catch (delErr) {
            this.logger.warn({ err: String(delErr) }, 'push endpoint prune failed');
          }
          continue;
        }
        if (err instanceof PushSendError && !err.retryable) {
          // A client error we do not model. Retrying re-earns it; log and move on.
          this.logger.warn(
            { deviceId: deviceIdOf(endpoint), status: err.status },
            'push refused, not retrying',
          );
          continue;
        }
        retryable++;
        this.logger.debug({ deviceId: deviceIdOf(endpoint), err: String(err) }, 'push send failed');
      }

      // Retry ONLY when something might still succeed. A row whose every failure was permanent
      // is finished — retrying it just re-delivers to whoever already got it.
      if (retryable > 0 && delivered === 0) {
        await this.repo.markRetryOrDead(
          row.id,
          row.attempts,
          MAX_ATTEMPTS,
          `${retryable} endpoint(s) failed transiently`,
        );
      } else {
        await this.repo.markSent(row.id);
      }
    }
  }
}

/**
 * The endpoint's device id, read from either casing.
 *
 * `PushEndpointRow` is drizzle's inferred type, so it SAYS `deviceId` — but the repository reads
 * these rows with raw `pg` (`SELECT *`), which returns the column names verbatim: `device_id`.
 * The existing code never tripped on it because every other field it touches is a single word.
 * Reading `e.deviceId` here would have been `undefined` at runtime, and the prune would have
 * silently done nothing while the log claimed otherwise.
 */
function deviceIdOf(e: PushEndpointRow): string {
  const raw = e as unknown as { deviceId?: string; device_id?: string };
  return raw.deviceId ?? raw.device_id ?? '';
}

function toTarget(e: PushEndpointRow): PushTarget {
  return {
    platform: e.platform as PushTarget['platform'],
    token: e.token ?? undefined,
    subscription: (e.subscription as WebPushSubscription | null) ?? undefined,
  };
}

function stringifyValues(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}
