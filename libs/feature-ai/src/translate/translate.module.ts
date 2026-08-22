import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { PostgresClient } from '@velchat/database';
import type { Redis } from 'ioredis';
import type { AppConfig } from '@velchat/config';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { LangRepository } from './lang.repository';
import { TranslationCache } from './translation-cache';
import { createTranslateProvider } from './create-translate';

export interface TranslateModuleDeps {
  config: AppConfig;
  logger: Logger;
  pg: PostgresClient;
  redis: Redis;
}

/** Wires the translation module (§A26 / §B20): provider (self-hosted/echo) + cache + prefs. */
@Module({})
export class TranslateModule {
  static forRoot(deps: TranslateModuleDeps): { module: DynamicModule } {
    const provider = createTranslateProvider(deps.config, deps.logger);
    const cache = new TranslationCache(deps.redis);
    const repo = new LangRepository(deps.pg);
    const service = new TranslateService(provider, cache, repo, deps.logger);
    return {
      module: {
        module: TranslateModule,
        controllers: [TranslateController],
        providers: [
          { provide: TranslateService, useValue: service },
          { provide: LangRepository, useValue: repo },
        ],
      },
    };
  }
}
