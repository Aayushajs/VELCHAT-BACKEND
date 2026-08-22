import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';
import { TenancyRepository } from './tenancy.repository';
import { TenancyEvents } from './tenancy.events';

export interface TenancyModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
}

@Module({})
export class TenancyModule {
  static forRoot(deps: TenancyModuleDeps): DynamicModule {
    const repo = new TenancyRepository(deps.pg);
    const events = new TenancyEvents(deps.eventBus);
    const service = new TenancyService(repo, events);
    return {
      module: TenancyModule,
      controllers: [TenancyController],
      providers: [
        { provide: TenancyService, useValue: service },
        { provide: TenancyRepository, useValue: repo },
      ],
    };
  }
}
