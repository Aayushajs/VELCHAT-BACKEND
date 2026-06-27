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
import { TenancyModule } from './tenancy/tenancy.module';
import { DirectoryModule } from './directory/directory.module';
import { AdminModule } from './admin/admin.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const PG_CLIENT = Symbol('PG_CLIENT');
export const VALKEY_CLIENT = Symbol('VALKEY_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * Directory & tenancy (§B3 / §A13): orgs, workspaces, teams, memberships, per-tenant RBAC + the
 * authorize API. Profiles/contacts (hashed discovery) land in a later increment.
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

    if (deps.config.VALKEY_URL) {
      const valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      managed.push(valkey);
      providers.push({ provide: VALKEY_CLIENT, useValue: valkey });
    }

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (pg && eventBus) {
      imports.push(TenancyModule.forRoot({ logger: deps.logger, pg, eventBus }));
      imports.push(DirectoryModule.forRoot({ pg, eventBus }));
      imports.push(AdminModule.forRoot({ pg }));
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
