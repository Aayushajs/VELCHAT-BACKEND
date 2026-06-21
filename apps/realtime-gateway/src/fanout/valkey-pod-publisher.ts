import type { Redis } from 'ioredis';
import type { PodEnvelope, PodPublisher } from '../fabric/event-router';

/**
 * Cross-pod delivery over Valkey pub/sub (§B9.2). Publishes a {userId, frame} envelope to
 * `pod:{podId}`; the pod holding that user's sockets (WsFabric) receives it and writes the frame.
 */
export class ValkeyPodPublisher implements PodPublisher {
  constructor(private readonly redis: Redis) {}

  async publishToPod(podId: string, envelope: PodEnvelope): Promise<void> {
    await this.redis.publish(`pod:${podId}`, JSON.stringify(envelope));
  }
}
