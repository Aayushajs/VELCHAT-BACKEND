import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresClient } from '@velchat/database';
import { CollabController } from './collab.controller';
import { CollabService } from './collab.service';
import { CollabRepository } from './collab.repository';

/** Wires Clips + Canvas (§A4.7): Postgres `clips` + `canvases`. */
@Module({})
export class CollabModule {
  static forRoot(deps: { pg: PostgresClient }): DynamicModule {
    const repo = new CollabRepository(deps.pg);
    const service = new CollabService(repo);
    return {
      module: CollabModule,
      controllers: [CollabController],
      providers: [
        { provide: CollabService, useValue: service },
        { provide: CollabRepository, useValue: repo },
      ],
    };
  }
}
