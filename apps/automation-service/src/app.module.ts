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
import { PostgresClient, MongoClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';
import { AutomationModule } from './automation/automation.module';
import { ListsModule } from './lists/lists.module';
import { CollabModule } from './collab/collab.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const PG_CLIENT = Symbol('PG_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * Bots, slash commands, workflows, outbound webhooks (§B17).
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

    // Automation: bots, slash commands, workflows, reminders + durable job runner (§B17).
    if (pg && eventBus) {
      const { module, wiring } = AutomationModule.forRoot({ logger: deps.logger, pg, eventBus });
      imports.push(module);
      const bus = eventBus;
      managed.push({
        name: 'automation-jobs',
        connect: async () => {
          await bus.start();
          wiring.worker.start();
        },
        ping: async () => true,
        close: async () => wiring.worker.stop(),
      });
    }

    // Collaboration (§A4.7) — Lists (task lists) + Clips + Canvas, all channel-attached (Postgres).
    if (pg) {
      imports.push(ListsModule.forRoot({ pg }));
      imports.push(CollabModule.forRoot({ pg }));
    }

    // Feature Flags & Remote Config (docs/FEATURE-FLAGS.md) — MongoDB-only, Valkey-cached. Wired
    // only when Mongo + Valkey + a bus are configured; otherwise the service boots without it. The
    // managed entry owns its clients' lifecycle (connect → ensureIndexes → worker) so there's no
    // parallel-connect race, and its ping feeds readiness.
    if (deps.config.MONGO_URL && deps.config.VALKEY_URL && eventBus) {
      const mongo = new MongoClient(deps.config.MONGO_URL, deps.logger);
      const redis = new ValkeyClient(deps.config.VALKEY_URL, deps.logger);
      const { module, wiring } = FeatureFlagsModule.forRoot({
        logger: deps.logger,
        mongo,
        redis: redis.redis,
        eventBus,
      });
      imports.push(module);
      managed.push({
        name: 'feature-flags',
        connect: async () => {
          await mongo.connect();
          await redis.connect();
          await wiring.repo.ensureIndexes();
          wiring.worker.start();
        },
        ping: async () => (await mongo.ping()) && (await redis.ping()),
        close: async () => {
          wiring.worker.stop();
          await mongo.close();
          await redis.close();
        },
      });
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
