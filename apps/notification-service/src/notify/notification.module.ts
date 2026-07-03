import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import type { PushSender } from '@velchat/push';
import type { Redis } from 'ioredis';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationRepository } from './notification.repository';
import { MembersProjection } from './members.projection';
import { OutboxWorker } from './outbox.worker';
import { NotificationConsumer } from './notification.consumer';

export interface NotificationModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  redis: Redis;
  eventBus: EventBus;
  push: PushSender;
}

/** Wires the notification pipeline. Returns handles so the caller starts the worker + bus. */
export class NotificationWiring {
  readonly repo: NotificationRepository;
  readonly members: MembersProjection;
  readonly service: NotificationService;
  readonly worker: OutboxWorker;
  readonly consumer: NotificationConsumer;

  constructor(deps: NotificationModuleDeps) {
    this.repo = new NotificationRepository(deps.pg);
    this.members = new MembersProjection(deps.redis);
    this.service = new NotificationService(this.repo, this.members, deps.logger);
    this.worker = new OutboxWorker(this.repo, deps.push, deps.logger);
    this.consumer = new NotificationConsumer(deps.eventBus, this.service, this.members);
  }
}

@Module({})
export class NotificationModule {
  static forRoot(deps: NotificationModuleDeps): {
    module: DynamicModule;
    wiring: NotificationWiring;
  } {
    const wiring = new NotificationWiring(deps);
    const module: DynamicModule = {
      module: NotificationModule,
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: wiring.service },
        { provide: NotificationRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
