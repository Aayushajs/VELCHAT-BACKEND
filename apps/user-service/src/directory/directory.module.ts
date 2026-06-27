import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { DirectoryRepository } from './directory.repository';
import { DirectoryEvents } from './directory.events';

export interface DirectoryModuleDeps {
  pg: PostgresClient;
  eventBus: EventBus;
}

@Module({})
export class DirectoryModule {
  static forRoot(deps: DirectoryModuleDeps): DynamicModule {
    const repo = new DirectoryRepository(deps.pg);
    const events = new DirectoryEvents(deps.eventBus);
    const service = new DirectoryService(repo, events);
    return {
      module: DirectoryModule,
      controllers: [DirectoryController],
      providers: [
        { provide: DirectoryService, useValue: service },
        { provide: DirectoryRepository, useValue: repo },
      ],
    };
  }
}
