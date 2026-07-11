import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { CallsController } from './calls.controller';
import { CallsService, type LivekitConfig } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallsEvents } from './calls.events';
import type { TurnConfig } from './ice';

export interface CallsModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
  livekit: LivekitConfig;
  turn: TurnConfig;
}

@Module({})
export class CallsModule {
  static forRoot(deps: CallsModuleDeps): DynamicModule {
    const repo = new CallsRepository(deps.pg);
    const events = new CallsEvents(deps.eventBus);
    const service = new CallsService(repo, events, deps.livekit, deps.turn);
    return {
      module: CallsModule,
      controllers: [CallsController],
      providers: [
        { provide: CallsService, useValue: service },
        { provide: CallsRepository, useValue: repo },
      ],
    };
  }
}
