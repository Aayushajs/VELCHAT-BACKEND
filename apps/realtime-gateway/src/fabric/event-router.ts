import type { ConnectionRegistry } from './connection-registry';

export interface PodPublisher {
  /** Publish a frame to the Valkey channel `pod:{podId}`; the owning pod writes it to the socket. */
  publishToPod(podId: string, frame: unknown): Promise<void>;
}

/**
 * §B9.2 delivery: for each recipient, look up the pods holding their sockets and publish the frame
 * to each pod's channel. Cross-pod via Valkey pub/sub (low latency); Kafka remains the durable source.
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
        await this.pub.publishToPod(podId, frame);
        deliveries += 1;
      }
    }
    return deliveries;
  }
}
