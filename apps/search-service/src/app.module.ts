import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus, type EventBus } from '@velchat/event-bus';
import { createSearchIndex, type SearchIndex } from '@velchat/search';
import { SearchModule } from '@velchat/feature-search';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const SEARCH_INDEX = Symbol('SEARCH_INDEX');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * search-service (§A18 / §B13). Indexes server-readable (enterprise/channel) content from the event
 * stream into Atlas Search/OpenSearch; queries are tenant-scoped by the index and ACL-filtered to
 * the caller's channels (§G6-3). Personal E2EE content is never indexed here (on-device only, §A18.2).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];
    const imports: DynamicModule[] = [];

    let eventBus: EventBus | undefined;
    let searchIndex: SearchIndex | undefined;

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (
      deps.config.SEARCH_PROVIDER === 'opensearch'
        ? deps.config.OPENSEARCH_NODE
        : deps.config.MONGO_URL
    ) {
      searchIndex = createSearchIndex(deps.config);
      managed.push(searchIndex);
      providers.push({ provide: SEARCH_INDEX, useValue: searchIndex });
    }

    if (eventBus && searchIndex) {
      const { module, wiring } = SearchModule.forRoot({ index: searchIndex, eventBus });
      imports.push(module);
      const bus = eventBus;
      managed.push({
        name: 'search-indexer',
        connect: async () => {
          wiring.consumer.register();
          await bus.start();
        },
        ping: async () => true,
        close: async () => undefined,
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
