import type { Logger } from '@velchat/common';
import { FeatureFlagsRepository } from './feature-flags.repository';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Durable schedule + cleanup worker (docs/FEATURE-FLAGS.md §8) — same interval-worker shape as the
 * automation JobWorker. Fires due enable/disable schedules through the service (so they audit +
 * invalidate + emit like a manual change) and prunes old version snapshots. Overlap-guarded.
 */
export class FlagScheduleWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly repo: FeatureFlagsRepository,
    private readonly service: FeatureFlagsService,
    private readonly logger: Logger,
    private readonly intervalMs = 15000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.repo.dueSchedules(new Date().toISOString());
      for (const s of due) {
        try {
          const flag = await this.repo.getById(s.flag_id);
          if (flag) {
            await this.service.setEnabled(
              s.tenant_id,
              s.created_by,
              flag.key,
              s.action === 'enable',
            );
            await this.repo.pruneVersions(s.flag_id, 50);
          }
          await this.repo.markScheduleDone(s._id);
        } catch (err) {
          this.logger.warn({ schedule: s._id, err: String(err) }, 'flag schedule apply failed');
        }
      }
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'flag schedule pass failed (db not ready?)');
    } finally {
      this.running = false;
    }
  }
}
