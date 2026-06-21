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
import { PostgresClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';
import { AuthModule } from './auth/auth.module';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * auth-service (§B2): DAPT auth, Reverse-OTP, RS256/JWKS + rotating-refresh tokens, device/key
 * directory. Shared infra clients come from @velchat/database + @velchat/cache (no per-service copy).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const imports: DynamicModule[] = [];

    // auth needs Postgres + Valkey; only wire AuthModule when both are configured so the service
    // still answers /health without infra.
    if (deps.config.POSTGRES_URL && deps.config.VALKEY_URL) {
      const pg = new PostgresClient(
        requirePostgresUrl(deps.config),
        deps.config.POSTGRES_MAX_POOL,
        deps.logger,
      );
      const valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      const eventBus = createEventBus(deps.config, deps.logger);
      managed.push(pg, valkey, eventBus);
      imports.push(
        AuthModule.forRoot({
          config: deps.config,
          logger: deps.logger,
          pg,
          redis: valkey.redis,
          eventBus,
        }),
      );
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
