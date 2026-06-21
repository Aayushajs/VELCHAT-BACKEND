import { Module, type DynamicModule } from '@nestjs/common';
import { requirePostgresUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus, type EventBus } from '@velchat/event-bus';
import { createStorage, type ObjectStorage } from '@velchat/storage';
import { PostgresClient } from '@velchat/database';
import { MediaModule } from './media/media.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const PG_CLIENT = Symbol('PG_CLIENT');
export const STORAGE = Symbol('STORAGE');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * media-service (§B11 / §A16): content-addressed upload + dedup, signed download, file.uploaded.
 * Blobs in object storage (Cloudinary/MinIO); metadata in Postgres. Personal media is ciphertext —
 * the server stores it opaquely and never transcodes/inspects it.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];
    const imports: DynamicModule[] = [];

    let pg: PostgresClient | undefined;
    let storage: ObjectStorage | undefined;
    let eventBus: EventBus | undefined;

    if (deps.config.POSTGRES_URL) {
      pg = new PostgresClient(
        requirePostgresUrl(deps.config),
        deps.config.POSTGRES_MAX_POOL,
        deps.logger,
      );
      managed.push(pg);
      providers.push({ provide: PG_CLIENT, useValue: pg });
    }

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (
      deps.config.STORAGE_PROVIDER === 's3' ? deps.config.S3_ENDPOINT : deps.config.CLOUDINARY_URL
    ) {
      storage = createStorage(deps.config);
      providers.push({ provide: STORAGE, useValue: storage });
    }

    // Wire the media feature only when all three backends are present (else stays a bare skeleton).
    if (pg && storage && eventBus) {
      imports.push(MediaModule.forRoot({ logger: deps.logger, pg, storage, eventBus }));
    }

    const lifecycle = new InfraLifecycle(managed, deps.logger);

    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: deps.config.SERVICE_NAME,
          version: deps.config.SERVICE_VERSION,
          metrics: deps.metrics,
          readiness: () => lifecycle.isReady(),
        }),
        ...imports,
      ],
      providers: [{ provide: InfraLifecycle, useValue: lifecycle }, ...providers],
      exports: providers.map((p) => p.provide),
    };
  }
}
