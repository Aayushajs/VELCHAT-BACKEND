import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from 'pino';

/**
 * A managed external dependency (DB client, cache, broker). Connect failures at boot are
 * logged but NOT fatal — the service must still answer `/health` (liveness) so the platform
 * can schedule it; `/ready` flips to not-ready until every dependency pings green.
 */
export interface ManagedResource {
  readonly name: string;
  connect(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Connects all managed resources on bootstrap, pings them for readiness, and closes them on
 * graceful shutdown (§B9 drain). Registered as a provider so Nest fires the lifecycle hooks.
 */
@Injectable()
export class InfraLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly resources: ManagedResource[],
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const r of this.resources) {
      try {
        await r.connect();
        this.logger.info({ resource: r.name }, 'infra connected');
      } catch (err) {
        this.logger.warn(
          { resource: r.name, err: err instanceof Error ? err.message : String(err) },
          'infra not reachable at boot (will retry on use)',
        );
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const r of this.resources) {
      try {
        await r.close();
      } catch {
        // best-effort drain
      }
    }
  }

  async isReady(): Promise<boolean> {
    for (const r of this.resources) {
      if (!(await r.ping())) return false;
    }
    return true;
  }
}
