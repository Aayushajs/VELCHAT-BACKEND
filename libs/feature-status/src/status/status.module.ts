import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusController } from './status.controller';
import { StatusService, type StatusThrottle } from './status.service';
import { StatusRepository } from './status.repository';
import { StatusEvents } from './status.events';
import { StatusExpiryWorker, type StatusExpiryOptions } from './status.expiry.worker';

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
  /** Absent means unlimited: the limiter is Valkey-backed and Valkey is optional in some profiles. */
  throttle?: StatusThrottle;
  expiry?: StatusExpiryOptions;
}

/**
 * Everything the module builds, exposed so the composition root can own the background worker's
 * lifecycle. Same shape as FeatureFlagsModule and NotificationModule.
 */
export class StatusWiring {
  readonly repo: StatusRepository;
  readonly service: StatusService;
  readonly worker: StatusExpiryWorker;

  constructor(deps: StatusModuleDeps) {
    this.repo = new StatusRepository(deps.pg);
    const events = new StatusEvents(deps.eventBus);
    this.service = new StatusService(this.repo, events, deps.social, deps.throttle);
    this.worker = new StatusExpiryWorker(this.repo, events, deps.logger, deps.expiry);
  }
}

/** Status / stories (§B8). Postgres-backed, so it lives in the content group, never in realtime. */
@Module({})
export class StatusModule {
  static forRoot(deps: StatusModuleDeps): { module: DynamicModule; wiring: StatusWiring } {
    const wiring = new StatusWiring(deps);
    const module: DynamicModule = {
      module: StatusModule,
      controllers: [StatusController],
      providers: [
        { provide: StatusService, useValue: wiring.service },
        { provide: StatusRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
