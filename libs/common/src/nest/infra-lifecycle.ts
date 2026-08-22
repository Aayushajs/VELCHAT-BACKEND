import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from 'pino';

/** Hard cap per dependency so one unreachable datastore never stalls boot (§B9). */
const BOOT_CONNECT_TIMEOUT_MS = 12_000;

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

  /**
   * Names of the dependencies this process actually opened. Exposed because "which stores does this
   * service connect to" is an architectural invariant worth asserting in a test rather than
   * describing in a comment — realtime-service, for instance, must never open Postgres.
   */
  get resourceNames(): readonly string[] {
    return this.resources.map((r) => r.name);
  }

  /**
   * Connect every dependency in PARALLEL, each bounded by a hard timeout, so an unreachable
   * datastore can't stall boot: total wait is max(one timeout), not the sum. A failure is logged,
   * not fatal — the service still serves `/health` and flips `/ready` green once pings pass (§B9).
   */
  async onApplicationBootstrap(): Promise<void> {
    await Promise.all(
      this.resources.map(async (r) => {
        try {
          await this.withTimeout(r.connect(), BOOT_CONNECT_TIMEOUT_MS, r.name);
          this.logger.info({ resource: r.name }, 'infra connected');
        } catch (err) {
          this.logger.warn(
            { resource: r.name, err: err instanceof Error ? err.message : String(err) },
            'infra not reachable at boot (will retry on use)',
          );
        }
      }),
    );
  }

  private withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name} connect timed out after ${ms}ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
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
