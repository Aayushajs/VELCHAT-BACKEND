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
import { MediaModule, BackupModule } from '@velchat/feature-media';
import { StatusModule } from '@velchat/feature-status';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * content-service — media + status/stories.
 *
 * Status lives here rather than with presence because it is content, not a realtime signal: images,
 * video, voice, an audience, view counts, a 24h TTL, and Postgres-backed metadata. Presence is pure
 * Valkey. Pairing them would have forced a Postgres pool into the WebSocket process and made every
 * status deploy drop every live socket.
 *
 * This is also the CPU-heavy process — ffmpeg transcoding lives here — which is exactly why it is
 * isolated from both the message hot path and the socket tier, and why its container carries a hard
 * CPU cap so it can never starve them on a 2-OCPU box.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const infra = createInfraContext(deps, { need: ['postgres', 'storage', 'eventBus'] });
    const { postgres, storage, eventBus } = infra;
    const imports: DynamicModule[] = [];

    if (postgres && storage && eventBus) {
      imports.push(MediaModule.forRoot({ logger: deps.logger, pg: postgres, storage, eventBus }));
    }
    // E2EE chat backup (§C21) — Postgres + storage, no event bus. Server stores ciphertext only.
    if (postgres && storage) {
      imports.push(BackupModule.forRoot({ pg: postgres, storage }));
    }
    if (postgres && eventBus) {
      imports.push(StatusModule.forRoot({ logger: deps.logger, pg: postgres, eventBus }));
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
