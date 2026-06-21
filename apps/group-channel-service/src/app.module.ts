import { Module, type DynamicModule } from '@nestjs/common';
import { requirePostgresUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus } from '@velchat/event-bus';
import { PostgresClient } from '@velchat/database';
import { ChannelsModule } from './channels/channels.module';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * group-channel-service (§B7): conversations (dm/group/channel/community), membership, roles.
 * Membership changes emit channel.member.* / conversation.created — consumed by realtime fan-out.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const imports: DynamicModule[] = [];

    if (deps.config.POSTGRES_URL) {
      const pg = new PostgresClient(
        requirePostgresUrl(deps.config),
        deps.config.POSTGRES_MAX_POOL,
        deps.logger,
      );
      const eventBus = createEventBus(deps.config, deps.logger);
      managed.push(pg, eventBus);
      imports.push(ChannelsModule.forRoot({ pg, eventBus }));
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
      providers: [{ provide: InfraLifecycle, useValue: lifecycle }],
    };
  }
}
