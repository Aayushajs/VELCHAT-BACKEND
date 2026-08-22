import type { Redis } from 'ioredis';
import type { ReverseOtpSession, ReverseOtpStore } from './reverse-otp.service';

/** Valkey-backed ephemeral store: `revotp:{sessionId}` with a short TTL (§B2.1). */
export class RedisReverseOtpStore implements ReverseOtpStore {
  constructor(private readonly redis: Redis) {}

  async put(session: ReverseOtpSession, ttlSec: number): Promise<void> {
    await this.redis.set(`revotp:${session.sessionId}`, JSON.stringify(session), 'EX', ttlSec);
  }

  async get(sessionId: string): Promise<ReverseOtpSession | null> {
    const raw = await this.redis.get(`revotp:${sessionId}`);
    return raw ? (JSON.parse(raw) as ReverseOtpSession) : null;
  }

  async del(sessionId: string): Promise<void> {
    await this.redis.del(`revotp:${sessionId}`);
  }
}
