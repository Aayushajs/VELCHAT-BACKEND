import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/shared-utils';
import { createEventBus } from '@velchat/event-bus';
import { createSearchIndex } from '@velchat/search';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const SEARCH_INDEX = Symbol('SEARCH_INDEX');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * Indexes events to Atlas Search/OpenSearch with tenant + ACL stamping (§B13).
 *
 * BOOT-0 skeleton: edge surface (health/ready/metrics, OTel, tenant context) + wired DB/Kafka
 * clients only. Business logic arrives in the phase prompts (see VelChat-ClaudeCode-Prompts.md).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      const eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (
      deps.config.SEARCH_PROVIDER === 'opensearch'
        ? deps.config.OPENSEARCH_NODE
        : deps.config.MONGO_URL
    ) {
      const searchIndex = createSearchIndex(deps.config);
      managed.push(searchIndex);
      providers.push({ provide: SEARCH_INDEX, useValue: searchIndex });
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
