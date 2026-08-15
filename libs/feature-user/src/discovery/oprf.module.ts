import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { PostgresClient } from '@velchat/database';
import { RateLimiter } from '@velchat/cache';
import type { Redis } from 'ioredis';
import { OprfController } from './oprf.controller';
import { OprfService } from './oprf.service';
import { OprfRepository } from './oprf.repository';

export interface OprfModuleDeps {
  pg: PostgresClient;
  redis: Redis;
  logger: Logger;
}

/** Wires OPRF-based contact discovery (§G2): Postgres key store + Valkey rate limiting. */
@Module({})
export class OprfModule {
  static forRoot(deps: OprfModuleDeps): DynamicModule {
    const repo = new OprfRepository(deps.pg);
    const rateLimiter = new RateLimiter(deps.redis);
    const service = new OprfService(repo, rateLimiter, deps.logger);
    return {
      module: OprfModule,
      controllers: [OprfController],
      providers: [
        { provide: OprfService, useValue: service },
        { provide: OprfRepository, useValue: repo },
      ],
    };
  }
}
