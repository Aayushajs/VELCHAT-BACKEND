import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import type { ObjectStorage } from '@velchat/storage';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaRepository } from './media.repository';
import { MediaEvents } from './media.events';

export interface MediaModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  storage: ObjectStorage;
  eventBus: EventBus;
}

@Module({})
export class MediaModule {
  static forRoot(deps: MediaModuleDeps): DynamicModule {
    const repo = new MediaRepository(deps.pg);
    const events = new MediaEvents(deps.eventBus);
    const service = new MediaService(repo, deps.storage, events);
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [
        { provide: MediaService, useValue: service },
        { provide: MediaRepository, useValue: repo },
      ],
    };
  }
}
