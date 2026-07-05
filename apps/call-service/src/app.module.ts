import { Module, type DynamicModule } from '@nestjs/common';
import { requirePostgresUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus, type EventBus } from '@velchat/event-bus';
import { PostgresClient } from '@velchat/database';
import { CallsModule } from './calls/calls.module';
import { ScreenControlModule } from './screen-control/screen-control.module';

export const EVENT_BUS = Symbol('EVENT_BUS');
export const PG_CLIENT = Symbol('PG_CLIENT');

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * call-service (§B12 / §A17): WebRTC signaling, LiveKit join tokens, meetings, lobby. Room/meeting
 * metadata in Postgres (entities in @velchat/database); media flows peer → coturn → LiveKit SFU and
 * never through here. LiveKit creds unset → the service still runs; join returns 503 CALLS_NOT_CONFIGURED.
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

    if (deps.config.EVENT_BUS === 'kafka' ? deps.config.KAFKA_BROKERS : deps.config.VALKEY_URL) {
      eventBus = createEventBus(deps.config, deps.logger);
      managed.push(eventBus);
      providers.push({ provide: EVENT_BUS, useValue: eventBus });
    }

    if (pg && eventBus) {
      imports.push(
        CallsModule.forRoot({
          logger: deps.logger,
          pg,
          eventBus,
          livekit: {
            url: deps.config.LIVEKIT_URL,
            apiKey: deps.config.LIVEKIT_API_KEY,
            apiSecret: deps.config.LIVEKIT_API_SECRET,
            ttlSec: deps.config.LIVEKIT_TOKEN_TTL_SECONDS,
          },
        }),
      );
      // Screen-share remote control (§A4.4) — Teams-style request/grant signaling.
      imports.push(ScreenControlModule.forRoot({ pg, eventBus }));
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
