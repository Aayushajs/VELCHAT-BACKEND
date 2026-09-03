import type { Logger } from 'pino';
import type { StatusRepository } from './status.repository';
import type { StatusEvents } from './status.events';

export interface StatusExpiryOptions {
  /** How long an expired or deleted row is retained before hard deletion. */
  graceHours?: number;
  intervalMs?: number;
  /** Rows marked per pass, bounding the work a single tick can do. */
  batchSize?: number;
}

/**
 * Two-stage status expiry — the same interval-worker shape as the automation JobWorker.
 *
 * This worker is deliberately NOT load-bearing for correctness. Reads filter
 * `state = 'active' AND expires_at > now()`, so an expired status is already invisible before this
 * runs. The worker exists to emit `status.expired`, so a client can drop it from a tray live, and
 * to reclaim rows. A crash, or a week of downtime, therefore delays cleanup without ever exposing
 * expired content.
 *
 * Stage one marks due rows and is idempotent: its predicate matches only rows still active, so a
 * re-run is a no-op. Stage two hard-deletes past the grace window, which is what lets media be
 * reclaimed asynchronously later without racing the purge.
 */
export class StatusExpiryWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly graceHours: number;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
    private readonly logger: Logger,
    opts: StatusExpiryOptions = {},
  ) {
    this.graceHours = opts.graceHours ?? 24;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.batchSize = opts.batchSize ?? 500;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // Do not hold the event loop open: a sweep is never a reason to delay shutdown.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return; // a slow pass must not overlap the next interval
    this.running = true;
    try {
      const expired = await this.repo.markExpired(this.batchSize);
      for (const row of expired) {
        try {
          await this.events.statusExpired(row.status_id, row.user_id);
        } catch (err) {
          // The row IS expired and already invisible to readers. A failed notification must not
          // stall the sweep or get retried into a loop.
          this.logger.warn(
            { statusId: row.status_id, err: String(err) },
            'status.expired publish failed',
          );
        }
      }
      const purged = await this.repo.purgeAfterGrace(this.graceHours);
      if (expired.length > 0 || purged > 0) {
        this.logger.info({ expired: expired.length, purged }, 'status expiry pass');
      }
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'status expiry pass failed (db not ready?)');
    } finally {
      this.running = false;
    }
  }
}
