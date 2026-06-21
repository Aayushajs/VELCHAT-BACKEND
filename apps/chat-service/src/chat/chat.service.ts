import { uuidv7, ValidationError } from '@velchat/common';
import { ChatRepository, isDuplicateKey } from './chat.repository';
import { SeqService } from './seq.service';
import { ChatEvents } from './chat.events';
import type { MessageDoc, SendAck, SendMessageInput } from './message.types';

/**
 * Send-message hot path (§B4.2) — does the MINIMUM sync work then emits, for low p99:
 * validate → dedupe(client_msg_id) → assign seq → persist → emit message.sent → ACK.
 * Content is opaque (E2EE ciphertext for personal); the server never inspects it.
 */
export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly seq: SeqService,
    private readonly events: ChatEvents,
  ) {}

  async send(input: SendMessageInput): Promise<SendAck> {
    if (!input.conversationId || !input.senderId || !input.clientMsgId || input.content == null) {
      throw new ValidationError('conversationId, senderId, clientMsgId and content are required');
    }

    // 2. Idempotent dedupe — return the existing message if this client_msg_id was already sent.
    const existing = await this.repo.findByClientMsgId(input.conversationId, input.clientMsgId);
    if (existing) return ack(existing);

    // 3. assign seq (atomic per-conversation).
    const seq = await this.seq.next(input.conversationId);

    // 4. persist (only required sync work).
    const now = new Date().toISOString();
    const doc: MessageDoc = {
      _id: uuidv7(),
      conversation_id: input.conversationId,
      seq,
      sender_id: input.senderId,
      client_msg_id: input.clientMsgId,
      type: input.type ?? 'text',
      content: input.content,
      reply_to: input.replyTo ?? null,
      thread_root: input.threadRoot ?? null,
      mentions: input.mentions ?? [],
      attachments: [],
      reactions: {},
      edited_at: null,
      deleted: false,
      deleted_scope: null,
      ephemeral_ttl: null,
      created_at: now,
      server_ts: now,
    };

    try {
      await this.repo.insert(doc);
    } catch (err) {
      // Concurrent duplicate (unique index on conversation_id+client_msg_id) → return the winner.
      if (isDuplicateKey(err)) {
        const winner = await this.repo.findByClientMsgId(input.conversationId, input.clientMsgId);
        if (winner) return ack(winner);
      }
      throw err;
    }

    // 5. emit (fan-out, notify, index happen off this event).
    await this.events.messageSent(doc);

    // 6. fast ACK.
    return ack(doc);
  }

  async history(conversationId: string, afterSeq = 0, limit = 50): Promise<MessageDoc[]> {
    return this.repo.history(conversationId, afterSeq, Math.min(Math.max(limit, 1), 100));
  }
}

function ack(m: MessageDoc): SendAck {
  return { messageId: m._id, seq: m.seq, serverTs: m.server_ts };
}
