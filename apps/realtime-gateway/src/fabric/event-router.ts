import type { ConnectionRegistry } from './connection-registry';

/** Delivered to a pod's `pod:{podId}` channel; the owning pod writes the frame to that user's sockets. */
export interface PodEnvelope {
  userId: string;
  frame: unknown;
}

export interface PodPublisher {
  /** Publish to the Valkey channel `pod:{podId}`; the owning pod writes `frame` to `userId`'s sockets. */
  publishToPod(podId: string, envelope: PodEnvelope): Promise<void>;
}

/**
 * §B9.2 delivery: for each recipient, look up the pods holding their sockets and publish a
 * {userId, frame} envelope to each pod's channel. Cross-pod via Valkey pub/sub (low latency);
 * the event bus remains the durable source, so a missed live push is re-synced by cursor (§G4).
 */
export class EventRouter {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pub: PodPublisher,
  ) {}

  /** Returns the number of (pod) deliveries attempted. */
  async route(recipientUserIds: string[], frame: unknown): Promise<number> {
    let deliveries = 0;
    for (const userId of recipientUserIds) {
      const pods = await this.registry.podsFor(userId);
      for (const podId of pods) {
        await this.pub.publishToPod(podId, { userId, frame });
        deliveries += 1;
      }
    }
    return deliveries;
  }
}
