import type { Redis } from 'ioredis';
import type { MongoClient } from '@velchat/database';

/**
 * Per-conversation monotonic sequence generator (§B4.3).
 *
 * Layering:
 *  - **Durable source of truth:** the Mongo `counters` collection (`{_id: conversationId, seq}`).
 *  - **Hot path:** Redis `seq:{conversationId}`, one round trip via Lua.
 *  - **Recovery:** if Redis restarts, evicts the key, or is unreachable, the counter is re-seeded
 *    from — or served entirely by — Mongo's atomic `$inc`.
 *
 * Why this much machinery for a counter: a bare `INCR` reissues 1, 2, 3 after Redis loses the key,
 * and the mobile client treats a known `(conversation_id, seq)` as a message it already holds — so
 * it SKIPS the new messages. Silent loss, no error on either side. Everything below exists to make
 * a reset impossible.
 *
 * The durable floor is `max(counters.seq, max(messages.seq))`, not `counters.seq` alone. The hot
 * path deliberately does not write to Mongo on every message, so the counter lags behind Redis;
 * taking it as authoritative would hand out a sequence number the messages collection has already
 * used, which the unique index would then reject (or, worse, the client would skip).
 */
export class SeqService {
  /** Last resort for unit tests and local runs with neither backend configured. */
  private readonly memoryCounters = new Map<string, number>();

  constructor(
    private readonly redis?: Redis | null,
    private readonly mongo?: MongoClient | null,
  ) {}

  async next(conversationId: string): Promise<number> {
    if (this.redis) {
      try {
        // One round trip: INCR when the key is warm, -1 to signal a cold start.
        const lua = `
          if redis.call('EXISTS', KEYS[1]) == 1 then
            return redis.call('INCR', KEYS[1])
          else
            return -1
          end
        `;
        const hot = (await this.redis.eval(lua, 1, `seq:${conversationId}`)) as number;
        if (hot > 0) return hot;

        // Cold start: seed strictly above everything already durable.
        const next = (await this.durableFloor(conversationId)) + 1;
        const seeded = await this.redis.set(`seq:${conversationId}`, next, 'NX');
        if (seeded === 'OK') {
          await this.persistDurableSeq(conversationId, next);
          return next;
        }
        // A concurrent worker seeded first; its value is also above the floor, so INCR is safe.
        return this.redis.incr(`seq:${conversationId}`);
      } catch {
        // Redis unreachable, timed out, or out of quota — degrade to the durable counter rather
        // than failing the send.
        if (this.mongo) return this.incrementDurable(conversationId);
      }
    }

    if (this.mongo) return this.incrementDurable(conversationId);

    const next = (this.memoryCounters.get(conversationId) ?? 0) + 1;
    this.memoryCounters.set(conversationId, next);
    return next;
  }

  /**
   * Highest sequence anything durable has seen. Reads BOTH the counter document and the messages
   * collection and takes the larger: the counter can lag (the hot path does not write it per
   * message), and the messages collection can lag if a counter was bumped for a send that then
   * failed. Only the maximum is safe.
   */
  private async durableFloor(conversationId: string): Promise<number> {
    if (!this.mongo) return 0;
    try {
      const counter = (await this.mongo.db
        .collection('counters')
        .findOne({ _id: conversationId as never })) as { seq?: number } | null;

      const lastMsg = (await this.mongo.db
        .collection('messages')
        .findOne({ conversation_id: conversationId }, { sort: { seq: -1 } })) as {
        seq?: number;
      } | null;

      return Math.max(
        typeof counter?.seq === 'number' ? counter.seq : 0,
        typeof lastMsg?.seq === 'number' ? lastMsg.seq : 0,
      );
    } catch {
      return 0;
    }
  }

  private async persistDurableSeq(conversationId: string, seq: number): Promise<void> {
    if (!this.mongo) return;
    try {
      // `$max`, so an out-of-order write can never move the counter backwards.
      await this.mongo.db
        .collection('counters')
        .updateOne({ _id: conversationId as never }, { $max: { seq } }, { upsert: true });
    } catch {
      // Best-effort: the floor is recomputed from messages as well, so a missed sync is survivable.
    }
  }

  /**
   * Serve a sequence number from Mongo alone — the Redis-outage path.
   *
   * It raises the counter to the durable floor BEFORE incrementing. Incrementing the counter
   * directly would be wrong: the hot path advanced Redis without writing Mongo, so the counter is
   * behind, and `$inc` from a stale value hands back a number the messages collection already used.
   */
  private async incrementDurable(conversationId: string): Promise<number> {
    if (!this.mongo) {
      const next = (this.memoryCounters.get(conversationId) ?? 0) + 1;
      this.memoryCounters.set(conversationId, next);
      return next;
    }

    const floor = await this.durableFloor(conversationId);
    // An aggregation-pipeline update, because `{$max: {seq}, $inc: {seq}}` is REJECTED by MongoDB —
    // two operators on one field conflict. The pipeline form does raise-then-increment in a single
    // atomic operation, so concurrent senders cannot both read the same value.
    const result = await this.mongo.db
      .collection('counters')
      .findOneAndUpdate(
        { _id: conversationId as never },
        [{ $set: { seq: { $add: [{ $max: ['$seq', floor] }, 1] } } }],
        { upsert: true, returnDocument: 'after' },
      );

    const doc =
      result && ('seq' in result ? result : (result as { value?: { seq?: number } }).value);
    return doc && typeof doc.seq === 'number' ? doc.seq : floor + 1;
  }
}
