import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { StatusRepository } from './status.repository';
import { StatusEvents } from './status.events';

export interface StatusModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
  /**
   * Answers "may this viewer see this author's status?". Owned by the directory, so it arrives as
   * a port the composition root wires — a feature lib may not import another feature lib. Fails
   * closed, so an unreachable directory denies rather than exposes.
   */
  social: SocialGraphResolver;
}

/** Status / stories (§B8). Postgres-backed, so it lives in the content group, never in realtime. */
@Module({})
export class StatusModule {
  static forRoot(deps: StatusModuleDeps): DynamicModule {
    const repo = new StatusRepository(deps.pg);
    const events = new StatusEvents(deps.eventBus);
    const service = new StatusService(repo, events, deps.social);
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
