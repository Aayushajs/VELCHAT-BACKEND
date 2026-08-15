import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { ScreenControlController } from './screen-control.controller';
import { ScreenControlService } from './screen-control.service';
import { ScreenControlRepository } from './screen-control.repository';
import { ScreenControlEvents } from './screen-control.events';

/** Wires screen-share remote control (§A4.4): Postgres state + call.control.* signaling events. */
@Module({})
export class ScreenControlModule {
  static forRoot(deps: { pg: PostgresClient; eventBus: EventBus }): DynamicModule {
    const repo = new ScreenControlRepository(deps.pg);
    const service = new ScreenControlService(repo, new ScreenControlEvents(deps.eventBus));
    return {
      module: ScreenControlModule,
      controllers: [ScreenControlController],
      providers: [
        { provide: ScreenControlService, useValue: service },
        { provide: ScreenControlRepository, useValue: repo },
      ],
    };
  }
}
