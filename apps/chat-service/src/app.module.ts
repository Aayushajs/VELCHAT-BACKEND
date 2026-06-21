import { Module, type DynamicModule } from '@nestjs/common';
import { requireMongoUrl, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus } from '@velchat/event-bus';
import { MongoClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const VALKEY_CLIENT = Symbol('VALKEY_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * Messages, delivery, receipts, ordering via per-conversation seq (§B4).
 *
 * BOOT-0 skeleton: edge surface (health/ready/metrics, OTel, tenant context) + wired DB/Kafka
 * clients only. Business logic arrives in the phase prompts (see VelChat-ClaudeCode-Prompts.md).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];

    if (deps.config.MONGO_URL) {
      const mongo = new MongoClient(requireMongoUrl(deps.config), deps.logger);
      managed.push(mongo);
      providers.push({ provide: MONGO_CLIENT, useValue: mongo });
    }

    if (deps.config.VALKEY_URL) {
      const valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      managed.push(valkey);
      providers.push({ provide: VALKEY_CLIENT, useValue: valkey });
    }

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      const eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
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
      ],
      providers: [{ provide: InfraLifecycle, useValue: lifecycle }, ...providers],
      exports: providers.map((p) => p.provide),
    };
  }
}
