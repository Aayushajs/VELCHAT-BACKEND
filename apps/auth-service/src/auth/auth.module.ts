import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from '@velchat/config';
import type { EventBus } from '@velchat/event-bus';
import type { Redis } from 'ioredis';
import { AuthController, JwksController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';
import { ReverseOtpService } from './reverse-otp.service';
import { RedisReverseOtpStore } from './reverse-otp.store';
import { DeviceKeyService } from './device-key.service';
import { AuthEvents } from './auth.events';
import { loadOrGenerateKeyPair } from './keys';
import type { PostgresClient } from '../infra/clients/postgres.client';

export interface AuthModuleDeps {
  config: AppConfig;
  logger: Logger;
  pg: PostgresClient;
  redis: Redis;
  eventBus: EventBus;
}

@Module({})
export class AuthModule {
  static forRoot(deps: AuthModuleDeps): DynamicModule {
    const repo = new AuthRepository(deps.pg);
    const keyPair = loadOrGenerateKeyPair({
      privatePem: process.env.JWT_PRIVATE_KEY,
      publicPem: process.env.JWT_PUBLIC_KEY,
    });
    const tokens = new TokenService(repo, {
      keyPair,
      issuer: deps.config.JWT_ISSUER ?? 'https://auth.velchat.local',
      accessTtlSec: deps.config.JWT_ACCESS_TTL_SECONDS,
    });
    const revotp = new ReverseOtpService(new RedisReverseOtpStore(deps.redis));
    const deviceKey = new DeviceKeyService(deps.redis);
    const events = new AuthEvents(deps.eventBus);
    const service = new AuthService(
      repo,
      tokens,
      revotp,
      deviceKey,
      events,
      deps.redis,
      deps.config.JWT_ACCESS_TTL_SECONDS,
    );

    return {
      module: AuthModule,
      controllers: [AuthController, JwksController],
      providers: [{ provide: AuthService, useValue: service }],
    };
  }
}
