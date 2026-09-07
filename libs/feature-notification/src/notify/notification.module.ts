import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import { buildEnvelope } from '@velchat/common';
import type { MessageReceiptPayload } from '@velchat/shared-types';
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
import type { DeviceAckState, DeviceReceiptEmitter } from './push-ack';

/**
 * Publishes a device ack as the SAME durable event a socket receipt produces, so a woken phone
 * and a connected one converge on one code path downstream — fanout, ordering and the sender's
 * tick are then identical whether the recipient's app was open or killed.
 *
 * Keyed by `conversation_id`, matching `ReceiptPublisher`, so per-conversation order holds even
 * when the two producers interleave.
 */
function busReceiptEmitter(bus: EventBus): DeviceReceiptEmitter {
  return {
    async emit(
      state: DeviceAckState,
      userId: string,
      conversationId: string,
      upToSeq: number,
    ): Promise<void> {
      await bus.publish<MessageReceiptPayload>(
        state === 'read' ? 'message.read' : 'message.delivered',
        buildEnvelope({
          eventType: state === 'read' ? 'message.read' : 'message.delivered',
          key: conversationId,
          producer: 'notification-service',
          payload: {
            conversation_id: conversationId,
            up_to_seq: upToSeq,
            user_id: userId,
            state,
            at: new Date().toISOString(),
          },
        }),
      );
    },
  };
}

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
    this.service = new NotificationService(
      this.repo,
      this.members,
      deps.logger,
      busReceiptEmitter(deps.eventBus),
    );
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
