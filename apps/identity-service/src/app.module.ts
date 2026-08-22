import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  GlobalAuthModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createInfraContext } from '@velchat/infra-context';
import { AuthModule } from '@velchat/feature-auth';
import { TenancyModule, DirectoryModule, AdminModule, OprfModule } from '@velchat/feature-user';
import { ChannelsModule } from '@velchat/feature-group-channel';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * identity-service — auth + user/tenancy + group/channel.
 *
 * All three are Postgres-backed request/response features on one authorization path, so they scale
 * on the same axis and share one connection pool. The real win is that the membership and
 * `authorize` checks chat and realtime used to make over HTTP become in-process calls here.
 *
 * Note on the JWT public key: group-channel previously read `process.env.JWT_PUBLIC_KEY`, which is
 * not in the config schema — so it always received an empty PEM and rejected every request. It now
 * takes the schema-backed `JWT_PUBLIC_PEM`, the same key the global guard verifies with.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const infra = createInfraContext(deps, { need: ['postgres', 'valkey', 'eventBus'] });
    const { postgres, valkey, eventBus } = infra;
    const imports: DynamicModule[] = [];

    if (postgres && valkey && eventBus) {
      imports.push(
        AuthModule.forRoot({
          config: deps.config,
          logger: deps.logger,
          pg: postgres,
          redis: valkey.redis,
          eventBus,
        }),
      );
    }

    if (postgres && eventBus) {
      imports.push(
        TenancyModule.forRoot({ logger: deps.logger, pg: postgres, eventBus }),
        DirectoryModule.forRoot({ pg: postgres, eventBus }),
        AdminModule.forRoot({ pg: postgres }),
        ChannelsModule.forRoot({
          pg: postgres,
          eventBus,
          jwtPublicKeyPem: deps.config.JWT_PUBLIC_PEM ?? '',
          jwtIssuer: deps.config.JWT_ISSUER ?? 'https://auth.velchat.local',
        }),
      );
    }

    // Privacy-preserving contact discovery via OPRF (§G2) — Postgres for the key/token store,
    // Valkey for per-account rate limiting on evaluate/match.
    if (postgres && valkey) {
      imports.push(OprfModule.forRoot({ pg: postgres, redis: valkey.redis, logger: deps.logger }));
    }

    const managed: ManagedResource[] = [...infra.managed];
    const lifecycle = new InfraLifecycle(managed, deps.logger);

    return {
      module: AppModule,
      imports: [
        GlobalAuthModule.forRoot(deps.config, deps.logger),
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
