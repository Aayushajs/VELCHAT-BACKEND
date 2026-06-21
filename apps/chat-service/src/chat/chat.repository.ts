import type { MongoClient } from '@velchat/database';
import type { MessageDoc } from './message.types';

const DUPLICATE_KEY = 11000;

export function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: number }).code === DUPLICATE_KEY
  );
}

/** Chat data access (§B4.1, Mongo `messages`). One service owns this collection (§A10). */
export class ChatRepository {
  constructor(private readonly mongo: MongoClient) {}

  private collection() {
    const db = this.mongo.connection?.db;
    if (!db) throw new Error('Mongo is not connected');
    return db.collection('messages');
  }

  /** §A10.2 indexes: history paging + client_msg_id dedupe. Run once at startup. */
  async ensureIndexes(): Promise<void> {
    const col = this.collection();
    await col.createIndex({ conversation_id: 1, seq: 1 }, { unique: true });
    await col.createIndex({ conversation_id: 1, client_msg_id: 1 }, { unique: true });
    await col.createIndex({ 'mentions.user_id': 1 });
  }

  async findByClientMsgId(conversationId: string, clientMsgId: string): Promise<MessageDoc | null> {
    const doc = await this.collection().findOne({
      conversation_id: conversationId,
      client_msg_id: clientMsgId,
    });
    return (doc as MessageDoc | null) ?? null;
  }

  async insert(doc: MessageDoc): Promise<void> {
    // Mongo's typings expect an ObjectId _id; ours is an app-generated UUIDv7 string (valid at runtime).
    await this.collection().insertOne(doc as never);
  }

  /** Cursor pagination by seq (§B4.3) — never offset. */
  async history(conversationId: string, afterSeq: number, limit: number): Promise<MessageDoc[]> {
    const docs = await this.collection()
      .find({ conversation_id: conversationId, seq: { $gt: afterSeq }, deleted: false })
      .sort({ seq: 1 })
      .limit(limit)
      .toArray();
    return docs as unknown as MessageDoc[];
  }
}
