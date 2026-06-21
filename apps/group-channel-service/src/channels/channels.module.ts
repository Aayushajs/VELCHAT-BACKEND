import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelsRepository } from './channels.repository';
import { ChannelsEvents } from './channels.events';

export interface ChannelsModuleDeps {
  pg: PostgresClient;
  eventBus: EventBus;
}

@Module({})
export class ChannelsModule {
  static forRoot(deps: ChannelsModuleDeps): DynamicModule {
    const repo = new ChannelsRepository(deps.pg);
    const events = new ChannelsEvents(deps.eventBus);
    const service = new ChannelsService(repo, events);
    return {
      module: ChannelsModule,
      controllers: [ChannelsController],
      providers: [
        { provide: ChannelsService, useValue: service },
        { provide: ChannelsRepository, useValue: repo },
      ],
    };
  }
}
