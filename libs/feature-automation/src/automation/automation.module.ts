import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { PostgresClient } from '@velchat/database';
import type { EventBus } from '@velchat/event-bus';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationRepository } from './automation.repository';
import { JobWorker } from './job.worker';

export interface AutomationModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
}

export class AutomationWiring {
  readonly repo: AutomationRepository;
  readonly service: AutomationService;
  readonly worker: JobWorker;

  constructor(deps: AutomationModuleDeps) {
    this.repo = new AutomationRepository(deps.pg);
    this.service = new AutomationService(this.repo, deps.logger);
    this.worker = new JobWorker(this.repo, deps.eventBus, deps.logger);
  }
}

/** Wires bots/slash/workflows/reminders + the durable job runner (§B17). */
@Module({})
export class AutomationModule {
  static forRoot(deps: AutomationModuleDeps): { module: DynamicModule; wiring: AutomationWiring } {
    const wiring = new AutomationWiring(deps);
    const module: DynamicModule = {
      module: AutomationModule,
      controllers: [AutomationController],
      providers: [
        { provide: AutomationService, useValue: wiring.service },
        { provide: AutomationRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
