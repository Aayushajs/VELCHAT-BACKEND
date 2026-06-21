import { Module, type DynamicModule } from '@nestjs/common';
import { requireMongoUrl, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
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
      // Create the §A10.2 indexes once Mongo is connected (runs after mongo in array order).
      const indexInit: ManagedResource = {
        name: 'chat-indexes',
        connect: async () => {
          await new ChatRepository(mongo).ensureIndexes();
          await receipts.ensureIndexes();
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
