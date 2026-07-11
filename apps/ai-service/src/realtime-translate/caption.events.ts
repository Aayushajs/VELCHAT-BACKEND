import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { CallCaptionPayload } from '@velchat/shared-types';

/** Emits `call.caption` per listener (§A26.3) → realtime-gateway routes it to that user's sockets. */
export class CaptionEvents {
  constructor(private readonly bus: EventBus) {}

  async caption(payload: CallCaptionPayload): Promise<void> {
    await this.bus.publish<CallCaptionPayload>(
      'call.caption',
      buildEnvelope({
        eventType: 'call.caption',
        key: payload.call_id,
        producer: 'ai-service',
        payload,
      }),
    );
  }
}
