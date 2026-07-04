import type { Redis } from 'ioredis';

/**
 * Fixed-window rate limiter (Valkey). Shared across services that gate sensitive actions per
 * IP / device / account (§B2.8 auth anti-pumping, §G2 OPRF lookup throttling, etc.).
 */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /** Returns true while under `limit` within `windowSec`; false once the limit is exceeded. */
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSec);
    return count <= limit;
  }
}
