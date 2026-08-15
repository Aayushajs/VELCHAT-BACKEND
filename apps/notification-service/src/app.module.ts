import { Module, type DynamicModule } from '@nestjs/common';
import { requirePostgresUrl, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus, type EventBus } from '@velchat/event-bus';
import { PostgresClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';
import { createPushRouter } from '@velchat/push';
import { createMailer } from '@velchat/mail';
import { NotificationModule } from '@velchat/feature-notification';
import { CampaignModule } from '@velchat/feature-notification';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const PG_CLIENT = Symbol('PG_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * notification-service (§B10 / §A19 / §G4): resolve recipients → apply prefs/presence → enqueue a
 * NO-CONTENT push into a durable, idempotent, DLQ-backed outbox → deliver with retry/backoff. Push is
 * a best-effort hint; unread/badge truth is cursor sync. E2EE payloads carry ids only.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];
    const imports: DynamicModule[] = [];

    let pg: PostgresClient | undefined;
    let valkey: ValkeyClient | undefined;
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

    if (deps.config.VALKEY_URL) {
      valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      managed.push(valkey);
    }

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (pg && valkey && eventBus) {
      const { module, wiring } = NotificationModule.forRoot({
        logger: deps.logger,
        pg,
        redis: valkey.redis,
        eventBus,
        push: createPushRouter(deps.config, deps.logger),
      });
      imports.push(module);
      // After infra connects: register consumers, start the bus, and start the outbox worker.
      const bus = eventBus;
      managed.push({
        name: 'notification-pipeline',
        connect: async () => {
          wiring.consumer.register();
          await bus.start();
          wiring.worker.start();
        },
        ping: async () => true,
        close: async () => wiring.worker.stop(),
      });

      // Bulk mail campaigns + scheduler (uses the shared @velchat/mail mailer from config).
      const campaigns = CampaignModule.forRoot({
        logger: deps.logger,
        pg,
        mailer: createMailer(deps.config, deps.logger),
      });
      imports.push(campaigns.module);
      managed.push({
        name: 'campaign-scheduler',
        connect: async () => campaigns.wiring.worker.start(),
        ping: async () => true,
        close: async () => campaigns.wiring.worker.stop(),
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
