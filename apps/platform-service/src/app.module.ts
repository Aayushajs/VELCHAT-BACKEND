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
import { CallsModule, ScreenControlModule } from '@velchat/feature-call';
import {
  AutomationModule,
  ListsModule,
  CollabModule,
  FeatureFlagsModule,
} from '@velchat/feature-automation';
import { TranslateModule, CaptionModule, createAiGateway } from '@velchat/feature-ai';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * platform-service — calls/signalling, automation/jobs, AI/translation.
 *
 * Three different scaling axes, but all near-idle in the MVP, so giving each its own process on a
 * 2-OCPU box was pure overhead. Server-side AI in particular stays quiet by design: personal
 * translation runs on-device (§A26.1) and server-side inference is enterprise-only.
 *
 * Documented split trigger: if server-side inference ever takes real load it must be extracted
 * FIRST, because CPU-bound inference in this process would starve the automation job runner and
 * call signalling beside it.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const infra = createInfraContext(deps, {
      need: ['postgres', 'valkey', 'mongo', 'eventBus'],
    });
    const { postgres, valkey, mongo, eventBus } = infra;
    const imports: DynamicModule[] = [];
    /** Workers started after the single bus start, stopped on drain. */
    const workers: Array<{ start: () => void; stop: () => void | Promise<void> }> = [];
    const afterConnect: Array<() => Promise<void>> = [];

    // ── calls & meetings (§B12): LiveKit join tokens + TURN credentials ────────────────────────
    if (postgres && eventBus) {
      imports.push(
        CallsModule.forRoot({
          logger: deps.logger,
          pg: postgres,
          eventBus,
          livekit: {
            url: deps.config.LIVEKIT_URL,
            apiKey: deps.config.LIVEKIT_API_KEY,
            apiSecret: deps.config.LIVEKIT_API_SECRET,
            ttlSec: deps.config.LIVEKIT_TOKEN_TTL_SECONDS,
          },
          turn: {
            stunUrls: deps.config.STUN_URLS,
            turnUrls: deps.config.TURN_URLS,
            turnSecret: deps.config.TURN_SECRET,
            ttlSec: deps.config.TURN_TTL_SECONDS,
          },
        }),
        ScreenControlModule.forRoot({ pg: postgres, eventBus }),
      );

      const automation = AutomationModule.forRoot({
        logger: deps.logger,
        pg: postgres,
        eventBus,
      });
      imports.push(
        automation.module,
        ListsModule.forRoot({ pg: postgres }),
        CollabModule.forRoot({ pg: postgres }),
      );
      workers.push(automation.wiring.worker);
    }

    // ── feature flags (§A4.7): Mongo-backed with a Valkey-cached read path ────────────────────
    if (mongo && valkey && eventBus) {
      const flags = FeatureFlagsModule.forRoot({
        logger: deps.logger,
        mongo,
        redis: valkey.redis,
        eventBus,
      });
      imports.push(flags.module);
      // Mongo/Valkey are connected by InfraLifecycle now — the old app.module connected them by
      // hand inside this block, which opened a second pair of connections per process.
      afterConnect.push(() => flags.wiring.repo.ensureIndexes());
      workers.push(flags.wiring.worker);
    }

    // ── AI / translation (§A25/§A26): self-hosted models only; personal stays on-device ───────
    if (postgres && valkey) {
      const translate = TranslateModule.forRoot({
        config: deps.config,
        logger: deps.logger,
        pg: postgres,
        redis: valkey.redis,
      });
      imports.push(translate.module);
    }
    if (eventBus) {
      imports.push(
        CaptionModule.forRoot({ ai: createAiGateway(deps.config, deps.logger), eventBus }),
      );
    }

    const managed: ManagedResource[] = [...infra.managed];

    // One bus start for the whole process, after every consumer is registered by the modules above.
    if (eventBus) {
      managed.push({
        name: 'platform-pipeline',
        connect: async () => {
          for (const fn of afterConnect) await fn();
          await eventBus.start();
          for (const w of workers) w.start();
        },
        ping: async () => true,
        close: async () => {
          for (const w of workers) await w.stop();
        },
      });
    }

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
