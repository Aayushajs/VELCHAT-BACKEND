import type { Logger } from '@velchat/common';
import type { PushSender, PushTarget, WebPushSubscription } from '@velchat/push';
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

  /** One delivery pass — exported for tests + the interval. */
  async tick(): Promise<void> {
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
      try {
        const data = stringifyValues(row.payload as Record<string, unknown>);
        await Promise.all(
          endpoints.map((e) => this.push.send(toTarget(e), { type: row.type, data })),
        );
        await this.repo.markSent(row.id);
      } catch (err) {
        await this.repo.markRetryOrDead(row.id, row.attempts, MAX_ATTEMPTS, String(err));
      }
    }
  }
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
