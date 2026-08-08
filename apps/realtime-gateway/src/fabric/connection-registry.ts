import type { Redis } from 'ioredis';

export interface ConnInfo {
  podId: string;
  connId: string;
  deviceId: string;
}

/**
 * §B9.1 connection registry in Valkey / Redis: `conn:{user}` is a set of {podId, connId, deviceId},
 * TTL-refreshed by heartbeat. Lets any pod find which pods hold a user's sockets (cross-pod
 * delivery via pub/sub). Stateless pods → horizontal scale.
 *
 * Hardening:
 * - Default TTL = 75s (3x standard 25s heartbeat interval to eliminate network jitter flapping).
 * - Safe JSON parsing with error boundaries.
 * - Multi-device safe unregister without dropping other active devices.
 */
export class ConnectionRegistry {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 75,
  ) {}

  private key(userId: string): string {
    return `conn:${userId}`;
  }

  async register(userId: string, conn: ConnInfo): Promise<void> {
    await this.redis.sadd(this.key(userId), JSON.stringify(conn));
    await this.redis.expire(this.key(userId), this.ttlSec);
  }

  async unregister(userId: string, connId: string): Promise<void> {
    const members = await this.redis.smembers(this.key(userId));
    for (const m of members) {
      try {
        const parsed = JSON.parse(m) as ConnInfo;
        if (parsed.connId === connId) {
          await this.redis.srem(this.key(userId), m);
        }
      } catch {
        // Drop malformed member
        await this.redis.srem(this.key(userId), m);
      }
    }
  }

  async heartbeat(userId: string): Promise<void> {
    await this.redis.expire(this.key(userId), this.ttlSec);
  }

  async connectionsFor(userId: string): Promise<ConnInfo[]> {
    const members = await this.redis.smembers(this.key(userId));
    const conns: ConnInfo[] = [];
    for (const m of members) {
      try {
        conns.push(JSON.parse(m) as ConnInfo);
      } catch {
        // Ignore malformed member
      }
    }
    return conns;
  }

  /** Distinct pods holding this user's sockets — the fan-out targets (§B9.2). */
  async podsFor(userId: string): Promise<string[]> {
    const conns = await this.connectionsFor(userId);
    return [...new Set(conns.map((c) => c.podId))];
  }

  /** Distinct pods holding a specific device's sockets — per-device routing (§B5.3 / §G1-2). */
  async podsForDevice(userId: string, deviceId: string): Promise<string[]> {
    const conns = await this.connectionsFor(userId);
    return [...new Set(conns.filter((c) => c.deviceId === deviceId).map((c) => c.podId))];
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(this.key(userId))) > 0;
  }
}
