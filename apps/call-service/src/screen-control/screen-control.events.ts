import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { ScreenControlStatus } from '@velchat/database';

/**
 * Screen-control signaling events (§A11/§A4.4), keyed by call_id so realtime-gw routes them to the
 * right participants: `requested` → the sharer, `granted`/`denied` → the controller, `released`/
 * `revoked` → both. The client relays actual input over the WebRTC data channel once active.
 */
export class ScreenControlEvents {
  constructor(private readonly bus: EventBus) {}

  async emit(input: {
    callId: string;
    controllerId: string;
    sharerId: string;
    status: ScreenControlStatus;
  }): Promise<void> {
    const eventType = `call.control.${input.status}`; // call.control.requested|active|denied|released|revoked
    await this.bus.publish(
      eventType,
      buildEnvelope({
        eventType,
        key: input.callId,
        producer: 'call-service',
        payload: {
          call_id: input.callId,
          controller_id: input.controllerId,
          sharer_id: input.sharerId,
          status: input.status,
        },
      }),
    );
  }
}
