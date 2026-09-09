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
import { ReceiptsRepository } from './receipts.repository';

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
    // Redis is the hot path, Mongo the durable source of truth — and the fallback when Redis is
    // unreachable, so a Valkey outage degrades latency rather than failing sends (§B4.3).
    const seq = new SeqService(deps.valkey.redis, deps.mongo);
    const events = new ChatEvents(deps.eventBus);
    // The receipt store is constructed here as well as in the composition root (which wires the
    // consumer that WRITES it), because the read side belongs to chat: a client asks for the
    // conversation it is looking at.
    const receiptStore = new ReceiptsRepository(deps.mongo);
    const service = new ChatService(repo, seq, events, receiptStore);

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
