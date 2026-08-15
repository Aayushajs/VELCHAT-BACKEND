import type { Logger } from 'pino';
import {
  requirePostgresUrl,
  requireMongoUrl,
  requireValkeyUrl,
  type AppConfig,
} from '@velchat/config';
import type { ManagedResource, ServiceMetrics } from '@velchat/common';
import { PostgresClient, MongoClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';
import { createEventBus, type EventBus } from '@velchat/event-bus';
import { createStorage, type ObjectStorage } from '@velchat/storage';
import { createSearchIndex, type SearchIndex } from '@velchat/search';

/** The infrastructure a composition root can ask for. */
export type InfraKind = 'postgres' | 'mongo' | 'valkey' | 'eventBus' | 'storage' | 'search';

export interface InfraDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

export interface InfraContextOptions {
  /** Exactly the backends this process uses. Anything not listed is never constructed. */
  need: InfraKind[];
}

export interface InfraContext extends InfraDeps {
  readonly postgres?: PostgresClient;
  readonly mongo?: MongoClient;
  readonly valkey?: ValkeyClient;
  readonly eventBus?: EventBus;
  readonly storage?: ObjectStorage;
  readonly search?: SearchIndex;
  /** Constructed clients, in construction order, for `InfraLifecycle` to connect and drain. */
  readonly managed: ManagedResource[];
  /** Whether a backend was both needed and configured — decides what a root can mount. */
  has(kind: InfraKind): boolean;
}

/** True when the config carries enough to build this backend. */
function configured(kind: InfraKind, config: AppConfig): boolean {
  switch (kind) {
    case 'postgres':
      return !!config.POSTGRES_URL;
    case 'mongo':
      return !!config.MONGO_URL;
    case 'valkey':
      return !!config.VALKEY_URL;
    case 'eventBus':
      return !!(config.EVENT_BUS === 'kafka' ? config.KAFKA_BROKERS : config.VALKEY_URL);
    case 'storage':
      return !!(config.STORAGE_PROVIDER === 's3' ? config.S3_ENDPOINT : config.CLOUDINARY_URL);
    case 'search':
      // The port has an adapter either way, but each adapter needs its own backing store — the
      // Atlas/Mongo-text adapter reads MONGO_URL and throws without it.
      return !!(config.SEARCH_PROVIDER === 'opensearch'
        ? config.OPENSEARCH_NODE
        : config.MONGO_URL);
  }
}

/**
 * Build exactly the infrastructure a process declares it needs — nothing more.
 *
 * Two problems this solves. First, all 13 app modules repeated the same "if the URL is set,
 * construct the client, push it onto `managed`" block, which is where per-service drift lives.
 * Second and more important: with 13 services each opening ~3 clients the deployment carried ~39
 * pooled connections, and a naive merge into 6 processes would have kept every one of them.
 * Declaring the need per process is what brings that down, and what keeps `realtime-service`
 * Valkey-only so the process holding every WebSocket never grows a Postgres pool.
 *
 * A needed-but-unconfigured backend is skipped rather than fatal, matching what the app modules
 * already did: the feature stays unmounted, the service boots, and readiness reports the truth
 * instead of the container crash-looping.
 *
 * Nothing here performs I/O — every client is lazy — so wiring is cheap and testable, and
 * `InfraLifecycle` remains the single place that actually connects and drains.
 */
export function createInfraContext(deps: InfraDeps, opts: InfraContextOptions): InfraContext {
  const { config, logger } = deps;
  const need = new Set(opts.need);
  const managed: ManagedResource[] = [];
  const wants = (kind: InfraKind) => need.has(kind) && configured(kind, config);

  const postgres = wants('postgres')
    ? new PostgresClient(requirePostgresUrl(config), config.POSTGRES_MAX_POOL, logger)
    : undefined;
  const mongo = wants('mongo') ? new MongoClient(requireMongoUrl(config), logger) : undefined;
  const valkey = wants('valkey') ? new ValkeyClient(requireValkeyUrl(config), logger) : undefined;
  const eventBus = wants('eventBus') ? createEventBus(config, logger) : undefined;
  const storage = wants('storage') ? createStorage(config) : undefined;
  const search = wants('search') ? createSearchIndex(config) : undefined;

  for (const r of [postgres, mongo, valkey, eventBus]) if (r) managed.push(r);

  const built: Record<InfraKind, unknown> = {
    postgres,
    mongo,
    valkey,
    eventBus,
    storage,
    search,
  };

  return {
    ...deps,
    postgres,
    mongo,
    valkey,
    eventBus,
    storage,
    search,
    managed,
    has: (kind) => built[kind] !== undefined,
  };
}
