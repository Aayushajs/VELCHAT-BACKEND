import type { MongoClient } from '@velchat/database';
import type { PollDoc } from './polls.logic';

interface VoteDoc {
  _id: string; // `${message_id}:${user_id}:${option_id}` — idempotent + deduped
  message_id: string;
  option_id: string;
  user_id: string;
  ts: string;
}

/** Poll data access (§B16, Mongo `polls` + `poll_votes`). Owned by chat-service (§A10). */
export class PollsRepository {
  constructor(private readonly mongo: MongoClient) {}

  private db() {
    const db = this.mongo.connection?.db;
    if (!db) throw new Error('Mongo is not connected');
    return db;
  }

  async ensureIndexes(): Promise<void> {
    await this.db().collection('poll_votes').createIndex({ message_id: 1, user_id: 1 });
    await this.db().collection('poll_votes').createIndex({ message_id: 1, option_id: 1 });
  }

  async createPoll(poll: PollDoc): Promise<void> {
    await this.db()
      .collection('polls')
      .insertOne(poll as never);
  }

  async getPoll(messageId: string): Promise<PollDoc | null> {
    const doc = await this.db()
      .collection('polls')
      .findOne({ _id: messageId as never });
    return (doc as PollDoc | null) ?? null;
  }

  async closePoll(messageId: string, closesAtIso: string): Promise<void> {
    await this.db()
      .collection('polls')
      .updateOne({ _id: messageId as never }, { $set: { closes_at: closesAtIso } });
  }

  /** Single-choice: drop the voter's previous picks so a re-vote replaces the old one. */
  async clearUserVotes(messageId: string, userId: string): Promise<void> {
    await this.db().collection('poll_votes').deleteMany({ message_id: messageId, user_id: userId });
  }

  /** Idempotent add (deterministic _id) — safe to retry, never double-counts. */
  async addVote(messageId: string, optionId: string, userId: string, ts: string): Promise<void> {
    const doc: VoteDoc = {
      _id: `${messageId}:${userId}:${optionId}`,
      message_id: messageId,
      option_id: optionId,
      user_id: userId,
      ts,
    };
    await this.db()
      .collection('poll_votes')
      .updateOne({ _id: doc._id as never }, { $setOnInsert: doc as never }, { upsert: true });
  }

  /** Tally: counts + voter sets per option (voters used only for non-anonymous display). */
  async tally(
    messageId: string,
  ): Promise<{ counts: Record<string, number>; voters: Record<string, string[]> }> {
    const rows = (await this.db()
      .collection('poll_votes')
      .aggregate([
        { $match: { message_id: messageId } },
        { $group: { _id: '$option_id', count: { $sum: 1 }, voters: { $addToSet: '$user_id' } } },
      ])
      .toArray()) as Array<{ _id: string; count: number; voters: string[] }>;
    const counts: Record<string, number> = {};
    const voters: Record<string, string[]> = {};
    for (const r of rows) {
      counts[r._id] = r.count;
      voters[r._id] = r.voters;
    }
    return { counts, voters };
  }
}
