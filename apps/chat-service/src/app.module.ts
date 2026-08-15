import { Module, type DynamicModule } from '@nestjs/common';
import { requireMongoUrl, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  GlobalAuthModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createEventBus } from '@velchat/event-bus';
import { MongoClient } from '@velchat/database';
import { ValkeyClient } from '@velchat/cache';
import { ChatModule } from './chat/chat.module';
import { ChatRepository } from './chat/chat.repository';
import { ReceiptsRepository } from './chat/receipts.repository';
import { ReceiptsConsumer } from './chat/receipts.consumer';
import { PollsModule } from './polls/polls.module';
import { ResendModule } from './resend/resend.module';
import { ExtrasModule } from './extras/extras.module';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * chat-service (§B4): messages, ordering (seq), receipts. Mongo for documents (@velchat/database),
 * Valkey for the per-conversation seq counter (@velchat/cache), Kafka for message.* events.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const imports: DynamicModule[] = [];

    if (deps.config.MONGO_URL && deps.config.VALKEY_URL) {
      const mongo = new MongoClient(requireMongoUrl(deps.config), deps.logger);
      const valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);
      const eventBus = createEventBus(deps.config, deps.logger);
      const receipts = new ReceiptsRepository(mongo);
      const polls = PollsModule.forRoot({ logger: deps.logger, mongo, valkey, eventBus });
      const resend = ResendModule.forRoot({ logger: deps.logger, mongo, eventBus });
      const extras = ExtrasModule.forRoot({ logger: deps.logger, mongo, eventBus });
      // Create the §A10.2 indexes once Mongo is connected (runs after mongo in array order).
      const indexInit: ManagedResource = {
        name: 'chat-indexes',
        connect: async () => {
          await new ChatRepository(mongo).ensureIndexes();
          await receipts.ensureIndexes();
          await polls.repo.ensureIndexes();
          await resend.repo.ensureIndexes();
          await extras.repo.ensureIndexes();
        },
        ping: async () => true,
        close: async () => undefined,
      };
      // Register receipt consumers, then start the bus (runs after eventBus.connect in array order).
      const consumerInit: ManagedResource = {
        name: 'chat-consumers',
        connect: async () => {
          new ReceiptsConsumer(eventBus, receipts, deps.logger).register();
          await eventBus.start();
        },
        ping: async () => true,
        close: async () => undefined,
      };
      managed.push(mongo, valkey, eventBus, indexInit, consumerInit);
      imports.push(ChatModule.forRoot({ logger: deps.logger, mongo, valkey, eventBus }));
      imports.push(polls.module);
      imports.push(resend.module);
      imports.push(extras.module);
    }

    const lifecycle = new InfraLifecycle(managed, deps.logger);

    return {
      module: AppModule,
      imports: [
        // Default-deny authentication (DEF-02). Throws at boot if this service cannot verify
        // tokens, so a misconfigured chat-service does not come up serving open endpoints.
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
