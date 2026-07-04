import { Module, type DynamicModule } from '@nestjs/common';
import { requirePostgresUrl, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus } from '@velchat/event-bus';
import { ValkeyClient } from '@velchat/cache';
import { PostgresClient } from '@velchat/database';
import { TranslateModule } from './translate/translate.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const VALKEY_CLIENT = Symbol('VALKEY_CLIENT');
export const PG_CLIENT = Symbol('PG_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * Translation/STT/TTS/summary; enterprise-only server path (privacy fork §A26.1).
 *
 * BOOT-0 skeleton: edge surface (health/ready/metrics, OTel, tenant context) + wired DB/Kafka
 * clients only. Business logic arrives in the phase prompts (see VelChat-ClaudeCode-Prompts.md).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];
    const imports: DynamicModule[] = [];

    let pg: PostgresClient | undefined;
    let valkey: ValkeyClient | undefined;

    if (deps.config.POSTGRES_URL) {
      pg = new PostgresClient(
        requirePostgresUrl(deps.config),
        deps.config.POSTGRES_MAX_POOL,
        deps.logger,
      );
      managed.push(pg);
      providers.push({ provide: PG_CLIENT, useValue: pg });
    }

    if (deps.config.VALKEY_URL) {
      valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      managed.push(valkey);
      providers.push({ provide: VALKEY_CLIENT, useValue: valkey });
    }

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      const eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    // Translation + language prefs (§A26 / §B20) — needs Postgres (prefs) + Valkey (cache).
    if (pg && valkey) {
      const { module } = TranslateModule.forRoot({
        config: deps.config,
        logger: deps.logger,
        pg,
        redis: valkey.redis,
      });
      imports.push(module);
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
