import { Module, type DynamicModule } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { JwtAuthGuard } from '@velchat/common';
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

    // JwtAuthGuard — verifies RS256 access JWTs on protected endpoints (§B2.3 / §D4).
    const jwtGuard = new JwtAuthGuard(new Reflector(), {
      publicKeyPem: deps.jwtPublicKeyPem,
      issuer: deps.jwtIssuer,
    });

    return {
      module: ChannelsModule,
      controllers: [ChannelsController],
      providers: [
        { provide: ChannelsService, useValue: service },
        { provide: ChannelsRepository, useValue: repo },
        { provide: JwtAuthGuard, useValue: jwtGuard },
      ],
    };
  }
}
