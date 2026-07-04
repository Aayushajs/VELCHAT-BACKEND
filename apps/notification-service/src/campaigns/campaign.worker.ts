import type { Logger } from '@velchat/common';
import { CampaignService } from './campaign.service';

/**
 * Mail-campaign scheduler worker. Every ~30s it asks the service to send all campaigns whose
 * next_run_at is due; the service claims them atomically (so replicas don't double-send), sends,
 * and reschedules recurring ones / completes one-shots. Overlap-guarded so a slow send batch never
 * stacks ticks.
 */
export class CampaignWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly service: CampaignService,
    private readonly logger: Logger,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scheduling pass — exported for tests + the interval. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.service.runDue(new Date());
      if (n > 0) this.logger.debug({ ran: n }, 'campaign scheduler pass');
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'campaign scheduler pass failed (db not ready?)');
    } finally {
      this.running = false;
    }
  }
}
