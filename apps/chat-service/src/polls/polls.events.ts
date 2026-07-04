import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { PollResults } from './polls.logic';

/** poll.updated event (§A11/§B16) — keyed by conversation_id so realtime-gw fans out live tallies. */
export class PollsEvents {
  constructor(private readonly bus: EventBus) {}

  async pollUpdated(conversationId: string, results: PollResults): Promise<void> {
    await this.bus.publish('poll.updated', {
      ...buildEnvelope({
        eventType: 'poll.updated',
        key: conversationId,
        producer: 'chat-service',
        payload: {
          conversation_id: conversationId,
          message_id: results.message_id,
          total: results.total,
          closed: results.closed,
          // Live counts only — never voter identities for anonymous polls.
          options: results.options.map((o) => ({ id: o.id, count: o.count })),
        },
      }),
    });
  }
}
