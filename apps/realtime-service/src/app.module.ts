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
import { createInfraContext, type InfraContext } from '@velchat/infra-context';
import { PresenceModule } from '@velchat/feature-presence';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/** Handed to main.ts so the WebSocket fabric reuses this process's single Valkey connection. */
export const INFRA = Symbol('INFRA');

/**
 * realtime-service — the WebSocket fabric plus presence/typing.
 *
 * Deliberately **Valkey-only**. Status/stories used to sit beside presence, but it is
 * Postgres-backed, so keeping them together would have put a Postgres pool inside the process that
 * holds every socket — and made every status deploy drop every live connection. Status moved to
 * content-service, which leaves this the leanest and least-redeployed process in the system.
 *
 * Two connection details this fixes, both from the old realtime-gateway:
 *  - it opened a SECOND ValkeyClient in main.ts on top of the one in app.module; there is now one,
 *    created here and shared;
 *  - the fabric read `process.env.JWT_PUBLIC_KEY`, which is not in the config schema, so it was
 *    always undefined and the fabric silently fell back to `jwt.decode` — accepting unsigned,
 *    forged tokens on every socket (DEF-06). It now uses the schema-backed `JWT_PUBLIC_PEM`.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const infra = createInfraContext(deps, { need: ['valkey', 'eventBus'] });
    const { valkey, eventBus } = infra;
    const imports: DynamicModule[] = [];

    if (valkey && eventBus) {
      imports.push(PresenceModule.forRoot({ redis: valkey.redis, eventBus }));
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
      providers: [
        { provide: InfraLifecycle, useValue: lifecycle },
        { provide: INFRA, useValue: infra as InfraContext },
      ],
      exports: [INFRA],
    };
  }
}
