import type { MongoClient } from '@velchat/database';

export interface PinDoc {
  _id: string; // `${conversationId}:${messageId}`
  conversation_id: string;
  message_id: string;
  pinned_by: string;
  pinned_at: string;
}

export interface StarDoc {
  _id: string; // `${userId}:${messageId}`
  user_id: string;
  message_id: string;
  conversation_id: string;
  starred_at: string;
}

export interface ConversationStateDoc {
  _id: string; // `${userId}:${conversationId}`
  user_id: string;
  conversation_id: string;
  archived: boolean;
  pinned: boolean; // pin the CHAT to the top (distinct from pinning a message)
  muted_until: string | null; // ISO; null = not muted
  updated_at: string;
}

/**
 * Chat extras (§A4.1 / §B15): message pins (conversation-scoped), stars/saves (per-user), and
 * per-user conversation state (archive, pin-to-top, mute). Owned by chat-service (§A10), all Mongo.
 */
export class ExtrasRepository {
  constructor(private readonly mongo: MongoClient) {}

  private db() {
    const db = this.mongo.connection?.db;
    if (!db) throw new Error('Mongo is not connected');
    return db;
  }

  async ensureIndexes(): Promise<void> {
    await this.db().collection('pins').createIndex({ conversation_id: 1, pinned_at: -1 });
    await this.db().collection('stars').createIndex({ user_id: 1, starred_at: -1 });
    await this.db().collection('conversation_state').createIndex({ user_id: 1, archived: 1 });
    await this.db().collection('conversation_state').createIndex({ user_id: 1, pinned: 1 });
  }

  // ── message pins (conversation-scoped) ──
  async pin(conversationId: string, messageId: string, by: string, now: string): Promise<void> {
    const _id = `${conversationId}:${messageId}`;
    await this.db()
      .collection('pins')
      .updateOne(
        { _id: _id as never },
        {
          $setOnInsert: {
            _id,
            conversation_id: conversationId,
            message_id: messageId,
            pinned_by: by,
            pinned_at: now,
          },
        },
        { upsert: true },
      );
  }

  async unpin(conversationId: string, messageId: string): Promise<void> {
    await this.db()
      .collection('pins')
      .deleteOne({ _id: `${conversationId}:${messageId}` as never });
  }

  async listPins(conversationId: string): Promise<PinDoc[]> {
    const rows = await this.db()
      .collection('pins')
      .find({ conversation_id: conversationId })
      .sort({ pinned_at: -1 })
      .toArray();
    return rows as unknown as PinDoc[];
  }

  // ── stars / saved messages (per-user) ──
  async star(
    userId: string,
    messageId: string,
    conversationId: string,
    now: string,
  ): Promise<void> {
    const _id = `${userId}:${messageId}`;
    await this.db()
      .collection('stars')
      .updateOne(
        { _id: _id as never },
        {
          $setOnInsert: {
            _id,
            user_id: userId,
            message_id: messageId,
            conversation_id: conversationId,
            starred_at: now,
          },
        },
        { upsert: true },
      );
  }

  async unstar(userId: string, messageId: string): Promise<void> {
    await this.db()
      .collection('stars')
      .deleteOne({ _id: `${userId}:${messageId}` as never });
  }

  async listStars(userId: string): Promise<StarDoc[]> {
    const rows = await this.db()
      .collection('stars')
      .find({ user_id: userId })
      .sort({ starred_at: -1 })
      .toArray();
    return rows as unknown as StarDoc[];
  }

  // ── per-user conversation state (archive / pin-to-top / mute) ──
  async setState(
    userId: string,
    conversationId: string,
    patch: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null },
    now: string,
  ): Promise<ConversationStateDoc> {
    const _id = `${userId}:${conversationId}`;
    const set: Record<string, unknown> = { updated_at: now };
    if (patch.archived !== undefined) set.archived = patch.archived;
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    if (patch.mutedUntil !== undefined) set.muted_until = patch.mutedUntil;
    await this.db()
      .collection('conversation_state')
      .updateOne(
        { _id: _id as never },
        {
          $setOnInsert: { _id, user_id: userId, conversation_id: conversationId },
          $set: set,
        },
        { upsert: true },
      );
    return (await this.db()
      .collection('conversation_state')
      .findOne({ _id: _id as never })) as unknown as ConversationStateDoc;
  }

  async getState(userId: string, conversationId: string): Promise<ConversationStateDoc | null> {
    const doc = await this.db()
      .collection('conversation_state')
      .findOne({ _id: `${userId}:${conversationId}` as never });
    return (doc as ConversationStateDoc | null) ?? null;
  }

  async listState(userId: string, filter: 'archived' | 'pinned'): Promise<ConversationStateDoc[]> {
    const rows = await this.db()
      .collection('conversation_state')
      .find({ user_id: userId, [filter]: true })
      .toArray();
    return rows as unknown as ConversationStateDoc[];
  }
}
