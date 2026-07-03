import type { Redis } from 'ioredis';
import type { ManualStatus } from './presence-state';

const ONLINE_TTL_SEC = 30;

/**
 * Hot presence state in Valkey (§B8). `online:{u}` is a TTL set of device ids (heartbeat-refreshed);
 * `lastseen:{u}` the last-online epoch; `pstatus:{u}` the manual status; `subscribers:{u}` the watchers
 * that get change fan-out (§A15.2 — only on-screen/recent contacts, never all N contacts).
 */
export class PresenceRepository {
  constructor(private readonly redis: Redis) {}

  async addDevice(userId: string, deviceId: string): Promise<void> {
    await this.redis.sadd(`online:${userId}`, deviceId);
    await this.redis.expire(`online:${userId}`, ONLINE_TTL_SEC);
  }

  async heartbeat(userId: string): Promise<void> {
    await this.redis.expire(`online:${userId}`, ONLINE_TTL_SEC);
  }

  async removeDevice(userId: string, deviceId: string): Promise<number> {
    await this.redis.srem(`online:${userId}`, deviceId);
    const remaining = await this.redis.scard(`online:${userId}`);
    if (remaining === 0) await this.redis.set(`lastseen:${userId}`, String(Date.now()));
    return remaining;
  }

  async onlineCount(userId: string): Promise<number> {
    return this.redis.scard(`online:${userId}`);
  }

  async lastSeen(userId: string): Promise<number | null> {
    const v = await this.redis.get(`lastseen:${userId}`);
    return v ? Number(v) : null;
  }

  async setManual(userId: string, status: ManualStatus): Promise<void> {
    await this.redis.set(`pstatus:${userId}`, JSON.stringify(status));
  }

  async getManual(userId: string): Promise<ManualStatus | null> {
    const v = await this.redis.get(`pstatus:${userId}`);
    return v ? (JSON.parse(v) as ManualStatus) : null;
  }

  async subscribe(watcher: string, targets: string[]): Promise<void> {
    const pipe = this.redis.pipeline();
    for (const t of targets) {
      pipe.sadd(`subscribers:${t}`, watcher);
      pipe.expire(`subscribers:${t}`, 300); // subscriptions are ephemeral (on-screen window)
    }
    await pipe.exec();
  }

  async subscribersOf(userId: string): Promise<string[]> {
    return this.redis.smembers(`subscribers:${userId}`);
  }
}
