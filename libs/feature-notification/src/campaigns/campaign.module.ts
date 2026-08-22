import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { PostgresClient } from '@velchat/database';
import type { Mailer } from '@velchat/mail';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CampaignRepository } from './campaign.repository';
import { CampaignWorker } from './campaign.worker';

export interface CampaignModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  mailer: Mailer;
}

export class CampaignWiring {
  readonly repo: CampaignRepository;
  readonly service: CampaignService;
  readonly worker: CampaignWorker;

  constructor(deps: CampaignModuleDeps) {
    this.repo = new CampaignRepository(deps.pg);
    this.service = new CampaignService(this.repo, deps.mailer, deps.logger);
    this.worker = new CampaignWorker(this.service, deps.logger);
  }
}

/** Wires the mail-campaign scheduler. Returns handles so the caller starts the worker. */
@Module({})
export class CampaignModule {
  static forRoot(deps: CampaignModuleDeps): { module: DynamicModule; wiring: CampaignWiring } {
    const wiring = new CampaignWiring(deps);
    const module: DynamicModule = {
      module: CampaignModule,
      controllers: [CampaignController],
      providers: [
        { provide: CampaignService, useValue: wiring.service },
        { provide: CampaignRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
