import type { Logger } from '@velchat/common';
import type { EventBus, EventHandler } from '@velchat/event-bus';
import type { MessageReceiptPayload } from '@velchat/shared-types';
import type { ReceiptsRepository } from './receipts.repository';

const GROUP = 'chat-receipts';

/**
 * Persists delivered/read receipts emitted by the realtime gateway (§B4.4). The store is the
 * durable source of ticks; realtime fan-out is the live cue. Idempotent + monotonic, so duplicate
 * or out-of-order events (at-least-once delivery) are safe.
 */
export class ReceiptsConsumer {
  constructor(
    private readonly bus: EventBus,
    private readonly repo: ReceiptsRepository,
    private readonly logger: Logger,
  ) {}

  register(): void {
    const handle: EventHandler<MessageReceiptPayload> = async (e) => {
      const r = e.payload;
      await this.repo.record({
        conversation_id: r.conversation_id,
        user_id: r.user_id,
        state: r.state,
        up_to_seq: r.up_to_seq,
        ts: r.at,
      });
      this.logger.debug(
        {
          conversation_id: r.conversation_id,
          user_id: r.user_id,
          state: r.state,
          seq: r.up_to_seq,
        },
        'receipt recorded',
      );
    };
    this.bus.subscribe<MessageReceiptPayload>('message.delivered', GROUP, handle);
    this.bus.subscribe<MessageReceiptPayload>('message.read', GROUP, handle);
  }
}
