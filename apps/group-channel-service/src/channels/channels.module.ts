import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { JwtAuthGuard, JWT_GUARD_OPTIONS_TOKEN } from '@velchat/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelsRepository } from './channels.repository';
import { ChannelsEvents } from './channels.events';

export interface ChannelsModuleDeps {
  pg: PostgresClient;
  eventBus: EventBus;
  /** PEM-encoded RSA public key for JWT verification (shared with auth-service). */
  jwtPublicKeyPem: string;
  /** Expected JWT issuer claim (must match auth-service). */
  jwtIssuer: string;
}

@Module({})
export class ChannelsModule {
  static forRoot(deps: ChannelsModuleDeps): DynamicModule {
    const repo = new ChannelsRepository(deps.pg);
    const events = new ChannelsEvents(deps.eventBus);
    const service = new ChannelsService(repo, events);

    return {
      module: ChannelsModule,
      controllers: [ChannelsController],
      providers: [
        { provide: ChannelsService, useValue: service },
        { provide: ChannelsRepository, useValue: repo },
        // Register the options token so NestJS DI can fully resolve JwtAuthGuard (§B2.3 / §D4).
        // Without this, DI crashes with "argument Object at index [1] not available".
        {
          provide: JWT_GUARD_OPTIONS_TOKEN,
          useValue: {
            publicKeyPem: deps.jwtPublicKeyPem,
            issuer: deps.jwtIssuer,
          },
        },
        JwtAuthGuard,
      ],
    };
  }
}
