import type { Logger } from '@velchat/common';
import type { EventRouter } from '../fabric/event-router';
import type { MembershipProjection } from './membership-projection';
import type { SkdmStore } from './skdm-store';

export interface SkdmTarget {
  userId: string;
  deviceId: string;
  /** Sender-key ciphertext, encrypted pairwise for this device — opaque to the server. */
  ciphertext: string;
}

/**
 * Sender-Key Distribution relay (§G1-2). A member distributes the group's epoch sender key to each
 * recipient device; online devices get it live, offline ones get it queued and replayed on reconnect.
 * A device that can't decrypt asks current members to re-send. The server only moves ciphertext.
 */
export class SkdmService {
  constructor(
    private readonly store: SkdmStore,
    private readonly router: EventRouter,
    private readonly projection: MembershipProjection,
    private readonly logger: Logger,
  ) {}

  /** Deliver each target's SKDM to its device; queue for any device that is offline. */
  async distribute(
    conversationId: string,
    epoch: number,
    fromUserId: string,
    targets: SkdmTarget[],
  ): Promise<void> {
    for (const t of targets) {
      const data = { conversationId, epoch, from: fromUserId, ciphertext: t.ciphertext };
      const delivered = await this.router.routeToDevice(t.userId, t.deviceId, {
        kind: 'durable',
        type: 'skdm',
        data,
      });
      if (delivered === 0) await this.store.enqueue(t.userId, t.deviceId, data); // offline → queue
    }
    this.logger.debug({ conversationId, epoch, targets: targets.length }, 'skdm distributed');
  }

  /** A device can't decrypt the current epoch — ask the other members to re-send the SKDM. */
  async request(
    conversationId: string,
    epoch: number,
    fromUserId: string,
    fromDeviceId: string,
  ): Promise<void> {
    const others = (await this.projection.members(conversationId)).filter((m) => m !== fromUserId);
    if (others.length === 0) return;
    await this.router.route(others, {
      kind: 'durable',
      type: 'skdm-request',
      data: { conversationId, epoch, requester: fromUserId, requesterDevice: fromDeviceId },
    });
  }

  /** On (re)connect, replay any SKDMs queued while the device was offline. */
  async flushOnConnect(userId: string, deviceId: string): Promise<void> {
    const pending = await this.store.drain(userId, deviceId);
    for (const data of pending) {
      await this.router.routeToDevice(userId, deviceId, { kind: 'durable', type: 'skdm', data });
    }
    if (pending.length > 0) {
      this.logger.debug({ userId, deviceId, count: pending.length }, 'skdm queue replayed');
    }
  }
}
