import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { MongoClient } from '@velchat/database';
import { ResendController } from './resend.controller';
import { ResendService } from './resend.service';
import { ResendRepository } from './resend.repository';
import { ResendEvents } from './resend.events';

export interface ResendModuleDeps {
  logger: Logger;
  mongo: MongoClient;
  eventBus: EventBus;
}

/** Wires the E2EE decryption-failure resend protocol (§G1-1): Mongo `resend_requests` + events. */
@Module({})
export class ResendModule {
  static forRoot(deps: ResendModuleDeps): { module: DynamicModule; repo: ResendRepository } {
    const repo = new ResendRepository(deps.mongo);
    const service = new ResendService(repo, new ResendEvents(deps.eventBus));
    const module: DynamicModule = {
      module: ResendModule,
      controllers: [ResendController],
      providers: [
        { provide: ResendService, useValue: service },
        { provide: ResendRepository, useValue: repo },
      ],
    };
    return { module, repo };
  }
}
