import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { CONVERSATION_MEMBERS_RESOLVER } from './members-resolver.token';
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
        // A string token so a single-process composition root can resolve membership WITHOUT
        // importing this feature (no package dependency, no coupling). It exists because healing
        // the realtime membership cache through our own HTTP API depends on routing, on the guard
        // and on a shared secret — and each of those fails by answering "no members", which
        // fan-out turns into a silently dropped message instead of an error.
        {
          provide: CONVERSATION_MEMBERS_RESOLVER,
          useValue: (conversationId: string): Promise<string[]> => service.members(conversationId),
        },
        { provide: ChannelsRepository, useValue: repo },
      ],
    };
  }
}
