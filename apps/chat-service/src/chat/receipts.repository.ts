import type { MongoClient } from '@velchat/database';

export interface ReceiptDoc {
  conversation_id: string;
  user_id: string;
  state: 'delivered' | 'read';
  up_to_seq: number;
  ts: string;
}

/**
 * Receipt store (§B4.4, Mongo `receipts`). One compact row per (conversation, user, state):
 * a single read/delivered marker covers every message at or below `up_to_seq`. Durable so that
 * other devices and reconnects pick the ticks up via the change-log (§B5).
 */
export class ReceiptsRepository {
  constructor(private readonly mongo: MongoClient) {}

  private collection() {
    const db = this.mongo.connection?.db;
    if (!db) throw new Error('Mongo is not connected');
    return db.collection('receipts');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection().createIndex(
      { conversation_id: 1, user_id: 1, state: 1 },
      { unique: true },
    );
  }

  /** Monotonic: a receipt only ever advances `up_to_seq`, so out-of-order events are harmless. */
  async record(r: ReceiptDoc): Promise<void> {
    await this.collection().updateOne(
      { conversation_id: r.conversation_id, user_id: r.user_id, state: r.state },
      { $max: { up_to_seq: r.up_to_seq }, $set: { ts: r.ts } },
      { upsert: true },
    );
  }
}
