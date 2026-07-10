import type { MongoClient } from '@velchat/database';
import type { MessageDoc, MessageEditHistoryEntry } from './message.types';

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
    return this.mongo.db.collection('messages');
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

  /** A message is addressed by `_id` + `conversation_id` (the shard key stays on the query). */
  async findById(conversationId: string, messageId: string): Promise<MessageDoc | null> {
    const doc = await this.collection().findOne({
      _id: messageId as never,
      conversation_id: conversationId,
    });
    return (doc as MessageDoc | null) ?? null;
  }

  /** Add a reaction — idempotent per (user, emoji) via `$addToSet` (§B15). */
  async addReaction(
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    await this.collection().updateOne(
      { _id: messageId as never, conversation_id: conversationId },
      { $addToSet: { [`reactions.${emoji}`]: userId } },
    );
  }

  /** Remove a reaction, then drop the emoji key entirely once its reactor list is empty (§B15). */
  async removeReaction(
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    const filter = { _id: messageId as never, conversation_id: conversationId };
    // `as never`: the message collection is untyped (app-generated string _id), so the driver's
    // schema-bound $pull/$unset typings don't apply — the operators are valid at runtime.
    await this.collection().updateOne(filter, {
      $pull: { [`reactions.${emoji}`]: userId },
    } as never);
    await this.collection().updateOne({ ...filter, [`reactions.${emoji}`]: { $size: 0 } }, {
      $unset: { [`reactions.${emoji}`]: '' },
    } as never);
  }

  /** Edit: set new content + edited_at, append the previous version to edit_history (§B15). */
  async applyEdit(
    conversationId: string,
    messageId: string,
    content: string | Record<string, unknown>,
    historyEntry: MessageEditHistoryEntry,
    editedAt: string,
  ): Promise<void> {
    await this.collection().updateOne(
      { _id: messageId as never, conversation_id: conversationId },
      {
        $set: { content, edited_at: editedAt },
        $push: { edit_history: historyEntry },
      } as never,
    );
  }

  /** Delete-for-everyone tombstone: keep the doc + seq, clear content, mark deleted (§B15). */
  async tombstone(conversationId: string, messageId: string): Promise<void> {
    await this.collection().updateOne(
      { _id: messageId as never, conversation_id: conversationId },
      { $set: { deleted: true, deleted_scope: 'everyone', content: '' } },
    );
  }

  /** Delete-for-me: per-user local hide recorded on the doc; no global tombstone/event (§B15). */
  async deleteForMe(conversationId: string, messageId: string, userId: string): Promise<void> {
    await this.collection().updateOne(
      { _id: messageId as never, conversation_id: conversationId },
      { $addToSet: { deleted_for: userId } },
    );
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
