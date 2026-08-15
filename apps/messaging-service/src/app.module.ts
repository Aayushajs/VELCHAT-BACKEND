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
import { createPushRouter } from '@velchat/push';
import { createMailer } from '@velchat/mail';
import {
  ChatModule,
  ChatRepository,
  ReceiptsRepository,
  ReceiptsConsumer,
  PollsModule,
  ResendModule,
  ExtrasModule,
} from '@velchat/feature-chat';
import { NotificationModule, CampaignModule } from '@velchat/feature-notification';
import { SearchModule } from '@velchat/feature-search';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * messaging-service — chat + notification + search in one process.
 *
 * They belong together because they are one pipeline, not three: chat produces `message.sent`,
 * notification and search each consume it, and all three read or write the Mongo `messages`
 * collection that chat owns. Search in particular has to live here — its index is a `$text` index
 * on that collection, so hosting it elsewhere would mean one service querying another service's
 * store, which §A10.5 forbids.
 *
 * The single-process merge introduces one hazard worth spelling out. As separate services, each of
 * chat, notification and search created its own event bus and called `start()` on it. Here there is
 * ONE bus, and `start()` begins consuming — so every consumer must be registered BEFORE it is
 * called, exactly once. Registration and startup are therefore separated below: features contribute
 * `register` callbacks during wiring, and a single lifecycle step runs them, starts the bus, then
 * starts the background workers.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    // Resolve auth FIRST. A service that cannot verify tokens must refuse before it opens a single
    // connection, not after — otherwise the failure surfaces as a confusing datastore error.
    const auth = GlobalAuthModule.forRoot(deps.config, deps.logger);

    const infra = createInfraContext(deps, {
      need: ['mongo', 'postgres', 'valkey', 'eventBus', 'search'],
    });

    const imports: DynamicModule[] = [];
    /** Consumer registrations — collected during wiring, all run before the bus starts. */
    const register: Array<() => void> = [];
    /** Index creation — runs once Mongo/Postgres are connected. */
    const ensureIndexes: Array<() => Promise<void>> = [];
    /** Background workers — started after the bus, stopped on drain. */
    const workers: Array<{ start: () => void; stop: () => void | Promise<void> }> = [];

    const { mongo, postgres, valkey, eventBus, search } = infra;

    // ── chat (§B4/§B15/§B16): messages, seq, receipts, reactions, polls, resend, extras ─────────
    if (mongo && valkey && eventBus) {
      const receipts = new ReceiptsRepository(mongo);
      const polls = PollsModule.forRoot({ logger: deps.logger, mongo, valkey, eventBus });
      const resend = ResendModule.forRoot({ logger: deps.logger, mongo, eventBus });
      const extras = ExtrasModule.forRoot({ logger: deps.logger, mongo, eventBus });

      imports.push(
        ChatModule.forRoot({ logger: deps.logger, mongo, valkey, eventBus }),
        polls.module,
        resend.module,
        extras.module,
      );
      ensureIndexes.push(async () => {
        await new ChatRepository(mongo).ensureIndexes();
        await receipts.ensureIndexes();
        await polls.repo.ensureIndexes();
        await resend.repo.ensureIndexes();
        await extras.repo.ensureIndexes();
      });
      register.push(() => new ReceiptsConsumer(eventBus, receipts, deps.logger).register());
    }

    // ── notification (§B10/§G4): push is a best-effort hint; cursor sync is the truth ───────────
    if (postgres && valkey && eventBus) {
      const notif = NotificationModule.forRoot({
        logger: deps.logger,
        pg: postgres,
        redis: valkey.redis,
        eventBus,
        push: createPushRouter(deps.config, deps.logger),
      });
      imports.push(notif.module);
      register.push(() => notif.wiring.consumer.register());
      workers.push(notif.wiring.worker);

      const campaigns = CampaignModule.forRoot({
        logger: deps.logger,
        pg: postgres,
        mailer: createMailer(deps.config, deps.logger),
      });
      imports.push(campaigns.module);
      workers.push(campaigns.wiring.worker);
    }

    // ── search (§B13): indexes only server-readable content; personal E2EE stays on-device ──────
    if (eventBus && search) {
      const s = SearchModule.forRoot({ index: search, eventBus });
      imports.push(s.module);
      register.push(() => s.wiring.consumer.register());
    }

    const managed: ManagedResource[] = [...infra.managed];

    if (ensureIndexes.length > 0) {
      managed.push({
        name: 'messaging-indexes',
        connect: async () => {
          for (const fn of ensureIndexes) await fn();
        },
        ping: async () => true,
        close: async () => undefined,
      });
    }

    // Registration → single bus start → workers. Order matters: starting the bus before every
    // consumer is registered would silently drop the events that arrive in between.
    if (eventBus) {
      managed.push({
        name: 'messaging-pipeline',
        connect: async () => {
          for (const fn of register) fn();
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
        auth,
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
