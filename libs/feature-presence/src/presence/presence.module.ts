import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { Redis } from 'ioredis';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { PresenceRepository } from './presence.repository';
import { PresenceEvents } from './presence.events';

export interface PresenceModuleDeps {
  redis: Redis;
  eventBus: EventBus;
}

@Module({})
export class PresenceModule {
  static forRoot(deps: PresenceModuleDeps): DynamicModule {
    const repo = new PresenceRepository(deps.redis);
    const events = new PresenceEvents(deps.eventBus);
    const service = new PresenceService(repo, events);
    return {
      module: PresenceModule,
      controllers: [PresenceController],
      providers: [
        { provide: PresenceService, useValue: service },
        { provide: PresenceRepository, useValue: repo },
      ],
    };
  }
}
