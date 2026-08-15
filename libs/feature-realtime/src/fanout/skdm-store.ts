import type { Redis } from 'ioredis';

/**
 * Per-device queue of Sender-Key Distribution Messages (§G1-2). When a member distributes the
 * group's sender key for an epoch and a recipient device is offline, the ciphertext SKDM is queued
 * here and replayed when that device reconnects — so an offline membership change can't leave a
 * device permanently unable to decrypt. Bounded + TTL'd; the server stores only ciphertext.
 */
export class SkdmStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 30 * 24 * 3600, // 30d retain-until-delivered window
    private readonly maxPerDevice = 500,
  ) {}

  private key(userId: string, deviceId: string): string {
    return `skdm:${userId}:${deviceId}`;
  }

  async enqueue(userId: string, deviceId: string, skdm: unknown): Promise<void> {
    const key = this.key(userId, deviceId);
    await this.redis.rpush(key, JSON.stringify(skdm));
    await this.redis.ltrim(key, -this.maxPerDevice, -1); // keep the newest N
    await this.redis.expire(key, this.ttlSec);
  }

  /** Drain (and clear) a device's queued SKDMs — called on reconnect. */
  async drain(userId: string, deviceId: string): Promise<unknown[]> {
    const key = this.key(userId, deviceId);
    const items = await this.redis.lrange(key, 0, -1);
    if (items.length > 0) await this.redis.del(key);
    return items.map((i) => JSON.parse(i) as unknown);
  }
}
