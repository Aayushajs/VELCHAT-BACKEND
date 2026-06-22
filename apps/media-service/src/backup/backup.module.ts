import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresClient } from '@velchat/database';
import type { ObjectStorage } from '@velchat/storage';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';

export interface BackupModuleDeps {
  pg: PostgresClient;
  storage: ObjectStorage;
}

@Module({})
export class BackupModule {
  static forRoot(deps: BackupModuleDeps): DynamicModule {
    const repo = new BackupRepository(deps.pg);
    const service = new BackupService(repo, deps.storage);
    return {
      module: BackupModule,
      controllers: [BackupController],
      providers: [
        { provide: BackupService, useValue: service },
        { provide: BackupRepository, useValue: repo },
      ],
    };
  }
}
