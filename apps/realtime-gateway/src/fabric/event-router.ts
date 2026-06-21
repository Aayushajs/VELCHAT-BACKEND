import type { ConnectionRegistry } from './connection-registry';

/**
 * Delivered to a pod's `pod:{podId}` channel; the owning pod writes the frame to the matching
 * socket(s). When `deviceId` is set the frame goes only to that one device (per-device E2EE fan-out
 * §B5.3 / SKDM delivery §G1-2); otherwise to every socket of `userId`.
 */
export interface PodEnvelope {
  userId: string;
  deviceId?: string;
  frame: unknown;
}

export interface PodPublisher {
  /** Publish to the Valkey channel `pod:{podId}`; the owning pod writes `frame` to the target socket(s). */
  publishToPod(podId: string, envelope: PodEnvelope): Promise<void>;
}

/**
 * §B9.2 delivery: look up the pods holding the recipient's sockets and publish an envelope to each
 * pod's channel. Cross-pod via Valkey pub/sub (low latency); the event bus remains the durable
 * source, so a missed live push is re-synced by cursor (§G4).
 */
export class EventRouter {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pub: PodPublisher,
  ) {}

  /** Fan a frame to every device of each recipient. Returns the number of pod deliveries attempted. */
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

  /** Deliver a frame to a single device — per-device E2EE ciphertext (§B5.3) and SKDMs (§G1-2). */
  async routeToDevice(userId: string, deviceId: string, frame: unknown): Promise<number> {
    let deliveries = 0;
    for (const podId of await this.registry.podsForDevice(userId, deviceId)) {
      await this.pub.publishToPod(podId, { userId, deviceId, frame });
      deliveries += 1;
    }
    return deliveries;
  }
}
