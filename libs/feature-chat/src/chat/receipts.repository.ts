import type { MongoClient } from '@velchat/database';

export interface ReceiptDoc {
  conversation_id: string;
  user_id: string;
  state: 'delivered' | 'read';
  up_to_seq: number;
  ts: string;
}

/**
 * A stored watermark as a caller outside this module wants it — camelCase, and without the
 * conversation id it already knows.
 */
export interface ReceiptWatermark {
  userId: string;
  state: 'delivered' | 'read';
  upToSeq: number;
  at: string;
}

/**
 * Receipt store (§B4.4, Mongo `receipts`). One compact row per (conversation, user, state):
 * a single read/delivered marker covers every message at or below `up_to_seq`. Durable so that
 * other devices and reconnects pick the ticks up via the change-log (§B5).
 */
export class ReceiptsRepository {
  constructor(private readonly mongo: MongoClient) {}

  private collection() {
    return this.mongo.db.collection('receipts');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection().createIndex(
      { conversation_id: 1, user_id: 1, state: 1 },
      { unique: true },
    );
  }

  /**
   * Every member's watermark for one conversation.
   *
   * This is the read half the store was built for and never got. Ticks travel as live socket
   * events, so a receipt published while the SENDER's socket happens to be down — a reconnect, a
   * network flip, a process the OS just restarted — is simply gone, and the message keeps one tick
   * for the rest of its life however long ago it was really read. Reading the durable row back is
   * the only thing that can repair that.
   *
   * Two rows per member at most (one per state), so this is bounded by conversation size and
   * needs no paging. The projection drops `_id` and the conversation id the caller passed in.
   */
  async forConversation(conversationId: string): Promise<ReceiptWatermark[]> {
    const docs = await this.collection()
      .find(
        { conversation_id: conversationId },
        { projection: { _id: 0, user_id: 1, state: 1, up_to_seq: 1, ts: 1 } },
      )
      .toArray();
    return (docs as unknown as ReceiptDoc[]).map((d) => ({
      userId: d.user_id,
      state: d.state,
      upToSeq: d.up_to_seq,
      at: d.ts,
    }));
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
