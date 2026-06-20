import { Module, type DynamicModule } from '@nestjs/common';
import { kafkaBrokers, requirePostgresUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
  EventPublisher,
  createKafka,
} from '@velchat/shared-utils';
import { PostgresClient } from './infra/clients/postgres.client';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
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

    if (deps.config.POSTGRES_URL) {
      const pg = new PostgresClient(
        requirePostgresUrl(deps.config),
        deps.config.POSTGRES_MAX_POOL,
        deps.logger,
      );
      managed.push(pg);
      providers.push({ provide: PG_CLIENT, useValue: pg });
    }

    if (deps.config.KAFKA_BROKERS) {
      const kafka = createKafka({
        clientId: deps.config.KAFKA_CLIENT_ID,
        brokers: kafkaBrokers(deps.config),
      });
      const publisher = new EventPublisher(kafka);
      managed.push({
        name: 'kafka',
        connect: () => publisher.connect(),
        ping: async () => true,
        close: () => publisher.disconnect(),
      });
      providers.push({ provide: EVENT_PUBLISHER, useValue: publisher });
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
