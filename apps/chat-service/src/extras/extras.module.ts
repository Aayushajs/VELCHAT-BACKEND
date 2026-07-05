import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { MongoClient } from '@velchat/database';
import { ExtrasController } from './extras.controller';
import { ExtrasService } from './extras.service';
import { ExtrasRepository } from './extras.repository';
import { ExtrasEvents } from './extras.events';

export interface ExtrasModuleDeps {
  logger: Logger;
  mongo: MongoClient;
  eventBus: EventBus;
}

/** Wires chat extras (§A4.1/§B15): pins, stars, archive/pin-to-top/mute. */
@Module({})
export class ExtrasModule {
  static forRoot(deps: ExtrasModuleDeps): { module: DynamicModule; repo: ExtrasRepository } {
    const repo = new ExtrasRepository(deps.mongo);
    const service = new ExtrasService(repo, new ExtrasEvents(deps.eventBus));
    const module: DynamicModule = {
      module: ExtrasModule,
      controllers: [ExtrasController],
      providers: [
        { provide: ExtrasService, useValue: service },
        { provide: ExtrasRepository, useValue: repo },
      ],
    };
    return { module, repo };
  }
}
