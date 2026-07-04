import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresClient } from '@velchat/database';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { ListsRepository } from './lists.repository';

/** Wires collaboration Lists (§A4.7): Postgres `lists` + `list_items`. */
@Module({})
export class ListsModule {
  static forRoot(deps: { pg: PostgresClient }): DynamicModule {
    const repo = new ListsRepository(deps.pg);
    const service = new ListsService(repo);
    return {
      module: ListsModule,
      controllers: [ListsController],
      providers: [
        { provide: ListsService, useValue: service },
        { provide: ListsRepository, useValue: repo },
      ],
    };
  }
}
