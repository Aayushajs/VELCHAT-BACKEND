import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { StatusRepository } from './status.repository';
import { StatusEvents } from './status.events';

export interface StatusModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
}

@Module({})
export class StatusModule {
  static forRoot(deps: StatusModuleDeps): DynamicModule {
    const repo = new StatusRepository(deps.pg);
    const events = new StatusEvents(deps.eventBus);
    const service = new StatusService(repo, events);
    return {
      module: StatusModule,
      controllers: [StatusController],
      providers: [
        { provide: StatusService, useValue: service },
        { provide: StatusRepository, useValue: repo },
      ],
    };
  }
}
