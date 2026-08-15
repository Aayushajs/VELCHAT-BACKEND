import type { MongoClient } from '@velchat/database';
import type { ResendStatus } from './resend.logic';

export interface ResendRequestDoc {
  _id: string; // `${messageId}:${requesterDeviceId}` — one live request per (message, device)
  message_id: string;
  conversation_id: string;
  requester_device_id: string;
  requester_id: string;
  sender_id: string;
  ratchet_hint: string | null;
  attempts: number;
  status: ResendStatus;
  created_at: string;
  updated_at: string;
}

/** Resend-request data access (§G1-1, Mongo `resend_requests`). Owned by chat-service (§A10). */
export class ResendRepository {
  constructor(private readonly mongo: MongoClient) {}

  private col() {
    return this.mongo.db.collection('resend_requests');
  }

  async ensureIndexes(): Promise<void> {
    await this.col().createIndex({ sender_id: 1, status: 1 });
    await this.col().createIndex({ message_id: 1 });
  }

  /** Read the original message (same chat-service DB) to derive its authoritative sender + conv. */
  async findMessage(
    messageId: string,
  ): Promise<{ conversation_id: string; sender_id: string } | null> {
    const doc = await this.mongo.db
      .collection('messages')
      .findOne({ _id: messageId as never }, { projection: { conversation_id: 1, sender_id: 1 } });
    return (doc as { conversation_id: string; sender_id: string } | null) ?? null;
  }

  async get(messageId: string, requesterDeviceId: string): Promise<ResendRequestDoc | null> {
    const doc = await this.col().findOne({ _id: `${messageId}:${requesterDeviceId}` as never });
    return (doc as ResendRequestDoc | null) ?? null;
  }

  /** Upsert a request, incrementing attempts + setting status. Returns the new attempt count. */
  async upsert(
    r: Omit<ResendRequestDoc, '_id' | 'attempts' | 'created_at' | 'updated_at'>,
    now: string,
  ): Promise<ResendRequestDoc> {
    const _id = `${r.message_id}:${r.requester_device_id}`;
    await this.col().updateOne(
      { _id: _id as never },
      {
        $setOnInsert: { _id, created_at: now, conversation_id: r.conversation_id },
        $set: {
          message_id: r.message_id,
          requester_device_id: r.requester_device_id,
          requester_id: r.requester_id,
          sender_id: r.sender_id,
          ratchet_hint: r.ratchet_hint,
          status: r.status,
          updated_at: now,
        },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );
    return (await this.col().findOne({ _id: _id as never })) as unknown as ResendRequestDoc;
  }

  async setStatus(
    messageId: string,
    requesterDeviceId: string,
    status: ResendStatus,
    now: string,
  ): Promise<void> {
    await this.col().updateOne(
      { _id: `${messageId}:${requesterDeviceId}` as never },
      { $set: { status, updated_at: now } },
    );
  }

  /** Pending requests a sender's devices need to fulfil (for flush-on-connect). */
  async pendingForSender(senderId: string, limit = 100): Promise<ResendRequestDoc[]> {
    const rows = await this.col()
      .find({ sender_id: senderId, status: 'requested' })
      .limit(limit)
      .toArray();
    return rows as unknown as ResendRequestDoc[];
  }
}
