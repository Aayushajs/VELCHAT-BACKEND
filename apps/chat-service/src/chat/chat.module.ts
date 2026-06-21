import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { MongoClient } from '@velchat/database';
import type { ValkeyClient } from '@velchat/cache';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './chat.repository';
import { SeqService } from './seq.service';
import { ChatEvents } from './chat.events';

export interface ChatModuleDeps {
  logger: Logger;
  mongo: MongoClient;
  valkey: ValkeyClient;
  eventBus: EventBus;
}

@Module({})
export class ChatModule {
  static forRoot(deps: ChatModuleDeps): DynamicModule {
    const repo = new ChatRepository(deps.mongo);
    const seq = new SeqService(deps.valkey.redis);
    const events = new ChatEvents(deps.eventBus);
    const service = new ChatService(repo, seq, events);

    return {
      module: ChatModule,
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        { provide: ChatRepository, useValue: repo },
      ],
    };
  }
}
