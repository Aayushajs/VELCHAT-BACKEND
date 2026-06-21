import type { Redis } from 'ioredis';

/**
 * Per-conversation monotonic sequence (§B4.3). Atomic Valkey INCR gives a total order without
 * relying on wall-clock; clients sort by `seq`, not timestamp. (Periodic Postgres checkpoint of
 * the counter is a P-later hardening task; Valkey is the live source.)
 */
export class SeqService {
  constructor(private readonly redis: Redis) {}

  async next(conversationId: string): Promise<number> {
    return this.redis.incr(`seq:${conversationId}`);
  }
}
