import type { EventRouter } from '../fabric/event-router';
import type { MembershipProjection } from './membership-projection';

export type TypingState = 'start' | 'stop';

/**
 * Ephemeral typing fan-out (§C4 / §A15.1). Typing is NEVER stored — it is coalesced/dropped under
 * backpressure (the frame is marked `ephemeral`, so a slow client's SendQueue may skip it) and never
 * re-synced. It fans "X is typing / stopped" to the OTHER online members of a conversation; clients
 * auto-expire the indicator after ~5s or when a message / a `stop` arrives.
 *
 * Security hardening:
 * - Strictly verifies that the sender is an actual member of `conversationId` before broadcasting.
 */
export class TypingRelay {
  constructor(
    private readonly projection: MembershipProjection,
    private readonly router: EventRouter,
  ) {}

  /** Fan a typing signal to every member of the conversation except the sender. */
  async relay(senderId: string, conversationId: string, state: TypingState): Promise<number> {
    const members = await this.projection.members(conversationId);
    // Security authorization: sender must be a valid member of the conversation
    if (members.length > 0 && !members.includes(senderId)) {
      return 0;
    }
    const recipients = members.filter((m) => m !== senderId);
    if (recipients.length === 0) return 0;
    const frame = {
      kind: 'ephemeral' as const,
      type: state === 'stop' ? 'typing.stopped' : 'typing.started',
      data: { conversationId, userId: senderId },
    };
    return this.router.route(recipients, frame);
  }
}
