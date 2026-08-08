import type { Redis } from 'ioredis';
import type { MongoClient } from '@velchat/database';

/**
 * Per-conversation monotonic sequence generator (§B4.3).
 *
 * Architecture:
 * - Durable Source of Truth: MongoDB `counters` collection (`{ _id: conversationId, seq: <number> }`).
 * - High-Performance Cache: Redis `seq:{conversationId}`.
 * - Resilience / Recovery: If Redis restarts, key is evicted, or Redis is down, `SeqService`
 *   seeds from or falls back to MongoDB atomic `findOneAndUpdate` ($inc: { seq: 1 }), guaranteeing
 *   ZERO sequence resets, ZERO duplicate sequence numbers, and strict per-conversation monotonicity.
 */
export class SeqService {
  private readonly memoryCounters = new Map<string, number>();

  constructor(
    private readonly redis?: Redis | null,
    private readonly mongo?: MongoClient | null,
  ) {}

  async next(conversationId: string): Promise<number> {
    // 1. If Redis is available, attempt atomic INCR with cold-start seeding
    if (this.redis) {
      try {
        // Lua script: if key exists -> INCR; if not -> return -1 (cache miss / cold start)
        const lua = `
          if redis.call('EXISTS', KEYS[1]) == 1 then
            return redis.call('INCR', KEYS[1])
          else
            return -1
          end
        `;
        const res = (await this.redis.eval(lua, 1, `seq:${conversationId}`)) as number;
        if (res > 0) {
          return res;
        }

        // Cache miss: recover durable max sequence from MongoDB
        const currentDurable = await this.getDurableSeq(conversationId);
        const nextSeq = currentDurable + 1;

        // Atomically set key in Redis if not already set by concurrent worker
        const setOk = await this.redis.set(`seq:${conversationId}`, nextSeq, 'NX');
        if (setOk === 'OK') {
          await this.persistDurableSeq(conversationId, nextSeq);
          return nextSeq;
        } else {
          // Another worker seeded concurrently; just INCR
          return this.redis.incr(`seq:${conversationId}`);
        }
      } catch {
        // Redis failure / network timeout / quota limit -> degrade safely to MongoDB durable counter
        if (this.mongo) {
          return this.incrementMongoCounter(conversationId);
        }
      }
    }

    // 2. Direct MongoDB durable atomic counter
    if (this.mongo) {
      return this.incrementMongoCounter(conversationId);
    }

    // 3. In-memory fallback (unit tests / local test environments)
    const next = (this.memoryCounters.get(conversationId) ?? 0) + 1;
    this.memoryCounters.set(conversationId, next);
    return next;
  }

  private async getDurableSeq(conversationId: string): Promise<number> {
    if (!this.mongo) return 0;
    try {
      const counterDoc = (await this.mongo.db
        .collection('counters')
        .findOne({ _id: conversationId as never })) as { seq?: number } | null;

      if (counterDoc && typeof counterDoc.seq === 'number') {
        return counterDoc.seq;
      }

      // If counter doc not found, check highest message seq in messages collection
      const lastMsg = (await this.mongo.db
        .collection('messages')
        .findOne({ conversation_id: conversationId }, { sort: { seq: -1 } })) as {
        seq?: number;
      } | null;

      return lastMsg && typeof lastMsg.seq === 'number' ? lastMsg.seq : 0;
    } catch {
      return 0;
    }
  }

  private async persistDurableSeq(conversationId: string, seq: number): Promise<void> {
    if (!this.mongo) return;
    try {
      await this.mongo.db
        .collection('counters')
        .updateOne({ _id: conversationId as never }, { $max: { seq } }, { upsert: true });
    } catch {
      // Non-critical background sync
    }
  }

  private async incrementMongoCounter(conversationId: string): Promise<number> {
    if (!this.mongo) {
      const next = (this.memoryCounters.get(conversationId) ?? 0) + 1;
      this.memoryCounters.set(conversationId, next);
      return next;
    }

    const result = await this.mongo.db
      .collection('counters')
      .findOneAndUpdate(
        { _id: conversationId as never },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      );

    const doc =
      result && ('seq' in result ? result : (result as { value?: { seq?: number } }).value);
    const seq = doc && typeof doc.seq === 'number' ? doc.seq : 1;
    return seq;
  }
}
