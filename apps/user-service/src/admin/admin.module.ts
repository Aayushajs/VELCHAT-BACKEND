import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresClient } from '@velchat/database';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';

export interface AdminModuleDeps {
  pg: PostgresClient;
}

@Module({})
export class AdminModule {
  static forRoot(deps: AdminModuleDeps): DynamicModule {
    const repo = new AdminRepository(deps.pg);
    // Reuse tenancy's role lookup for admin gating (single source of truth for RBAC).
    const tenancy = new TenancyRepository(deps.pg);
    const service = new AdminService(repo, (userId, orgId) =>
      tenancy.getRole(userId, 'org', orgId),
    );
    return {
      module: AdminModule,
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: service },
        { provide: AdminRepository, useValue: repo },
      ],
    };
  }
}
