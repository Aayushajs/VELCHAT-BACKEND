import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { MongoClient } from '@velchat/database';
import type { EventBus } from '@velchat/event-bus';
import type { Redis } from 'ioredis';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsRepository } from './feature-flags.repository';
import { FeatureFlagsCache } from './feature-flags.cache';
import { FeatureFlagsEvents } from './feature-flags.events';
import { FlagScheduleWorker } from './flag-schedule.worker';

export interface FeatureFlagsModuleDeps {
  logger: Logger;
  mongo: MongoClient;
  redis: Redis;
  eventBus: EventBus;
}

export class FeatureFlagsWiring {
  readonly repo: FeatureFlagsRepository;
  readonly service: FeatureFlagsService;
  readonly worker: FlagScheduleWorker;

  constructor(deps: FeatureFlagsModuleDeps) {
    this.repo = new FeatureFlagsRepository(deps.mongo);
    const cache = new FeatureFlagsCache(deps.redis);
    const events = new FeatureFlagsEvents(deps.eventBus);
    this.service = new FeatureFlagsService(this.repo, cache, events);
    this.worker = new FlagScheduleWorker(this.repo, this.service, deps.logger);
  }
}

/** Feature Flag & Remote-Config platform (docs/FEATURE-FLAGS.md). MongoDB-only, Valkey-cached. */
@Module({})
export class FeatureFlagsModule {
  static forRoot(deps: FeatureFlagsModuleDeps): {
    module: DynamicModule;
    wiring: FeatureFlagsWiring;
  } {
    const wiring = new FeatureFlagsWiring(deps);
    const module: DynamicModule = {
      module: FeatureFlagsModule,
      controllers: [FeatureFlagsController],
      providers: [
        { provide: FeatureFlagsService, useValue: wiring.service },
        { provide: FeatureFlagsRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
