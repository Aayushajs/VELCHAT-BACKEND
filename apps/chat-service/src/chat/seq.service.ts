import type { Redis } from 'ioredis';

/** Durable high-water mark for a conversation — `MAX(seq)` from the message store, 0 if none. */
export interface SeqFloor {
  maxSeq(conversationId: string): Promise<number>;
}

/**
 * Per-conversation monotonic sequence (§B4.3). Atomic Valkey INCR gives a total order without
 * relying on wall-clock; clients sort by `seq`, not timestamp.
 *
 * Valkey is the FAST path, never the source of truth. A restart, an eviction or a FLUSHALL wipes
 * `seq:*`, and a bare INCR would then reissue 1, 2, 3 — which the mobile client silently drops,
 * because `reconcileDecision` treats a known `(conversation_id, seq)` as a message it already
 * holds. So a cold counter is re-seeded from the durable high-water mark before it is used.
 *
 * Cold-start races are safe by construction: concurrent callers all read the same floor, but only
 * one `SET NX` wins. The losers' `SET` is a no-op and their `INCR` still lands above the winner's,
 * so every caller gets a distinct value strictly greater than the floor.
 */
export class SeqService {
  constructor(
    private readonly redis: Redis,
    private readonly floor: SeqFloor,
  ) {}

  async next(conversationId: string): Promise<number> {
    const key = `seq:${conversationId}`;
    if (await this.redis.exists(key)) return this.redis.incr(key);

    const floor = await this.floor.maxSeq(conversationId);
    await this.redis.set(key, String(floor), 'NX');
    return this.redis.incr(key);
  }
}
