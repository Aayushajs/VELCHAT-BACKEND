import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { MongoClient } from '@velchat/database';
import type { ValkeyClient } from '@velchat/cache';
import { PollsController } from './polls.controller';
import { PollsService } from './polls.service';
import { PollsRepository } from './polls.repository';
import { PollsCache } from './polls.cache';
import { PollsEvents } from './polls.events';

export interface PollsModuleDeps {
  logger: Logger;
  mongo: MongoClient;
  valkey: ValkeyClient;
  eventBus: EventBus;
}

/** Wires polls (§B16): Mongo `polls`/`poll_votes` + Valkey tally cache + poll.updated events. */
@Module({})
export class PollsModule {
  static forRoot(deps: PollsModuleDeps): { module: DynamicModule; repo: PollsRepository } {
    const repo = new PollsRepository(deps.mongo);
    const service = new PollsService(
      repo,
      new PollsCache(deps.valkey.redis),
      new PollsEvents(deps.eventBus),
    );
    const module: DynamicModule = {
      module: PollsModule,
      controllers: [PollsController],
      providers: [
        { provide: PollsService, useValue: service },
        { provide: PollsRepository, useValue: repo },
      ],
    };
    return { module, repo };
  }
}
