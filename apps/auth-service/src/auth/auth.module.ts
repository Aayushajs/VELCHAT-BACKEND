import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from '@velchat/config';
import type { EventBus } from '@velchat/event-bus';
import type { Redis } from 'ioredis';
import { AuthController, JwksController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { TokenService } from './tokens/token.service';
import { ReverseOtpService } from './reverse-otp/reverse-otp.service';
import { RedisReverseOtpStore } from './reverse-otp/reverse-otp.store';
import { DeviceKeyService } from './dapt/device-key.service';
import { MagicLinkService } from './dapt/magic-link.service';
import { ApproveDeviceService } from './dapt/approve-device.service';
import { PasskeyService } from './dapt/passkey.service';
import { RecoveryService } from './recovery/recovery.service';
import { RateLimiter } from './abuse/rate-limiter';
import { createMailer } from '@velchat/mail';
import { AuthEvents } from './auth.events';
import { loadOrGenerateKeyPair } from './tokens/keys';
import type { PostgresClient } from '@velchat/database';

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
    const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080';
    const magicLink = new MagicLinkService(
      deps.redis,
      createMailer(deps.config, deps.logger),
      baseUrl,
    );
    const approve = new ApproveDeviceService(deps.redis);
    const passkey = new PasskeyService(
      {
        rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
        rpName: process.env.WEBAUTHN_RP_NAME ?? 'VelChat',
        origin: process.env.WEBAUTHN_ORIGIN ?? baseUrl,
      },
      deps.redis,
    );
    const recovery = new RecoveryService(deps.redis);
    const rateLimiter = new RateLimiter(deps.redis);
    const events = new AuthEvents(deps.eventBus);
    const service = new AuthService(
      repo,
      tokens,
      revotp,
      deviceKey,
      magicLink,
      approve,
      passkey,
      recovery,
      rateLimiter,
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
