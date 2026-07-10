import { uuidv7, ValidationError, ForbiddenError, NotFoundError } from '@velchat/common';
import { ChatRepository, isDuplicateKey } from './chat.repository';
import { SeqService } from './seq.service';
import { ChatEvents } from './chat.events';
import type {
  MessageDoc,
  MessageEditHistoryEntry,
  SendAck,
  SendMessageInput,
  ReactInput,
  EditMessageInput,
  EditAck,
  DeleteMessageInput,
} from './message.types';

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
      edit_history: [],
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

    // 5. emit (fan-out, notify, index happen off this event). Carry plaintext for full-text search
    //    ONLY when server-readable (enterprise/channel + not encrypted); personal E2EE stays opaque.
    const serverReadable = !!input.tenantId && !input.encrypted;
    const searchText = serverReadable && typeof doc.content === 'string' ? doc.content : undefined;
    await this.events.messageSent(doc, input.tenantId ?? null, searchText);

    // 6. fast ACK.
    return ack(doc);
  }

  async history(conversationId: string, afterSeq = 0, limit = 50): Promise<MessageDoc[]> {
    return this.repo.history(conversationId, afterSeq, Math.min(Math.max(limit, 1), 100));
  }

  /** Add a reaction (§B15). Storage is idempotent per (user, emoji); the event is a live cue. */
  async react(input: ReactInput): Promise<{ message: string }> {
    requireReaction(input);
    await this.repo.addReaction(input.conversationId, input.messageId, input.userId, input.emoji);
    await this.events.reaction(
      true,
      input.conversationId,
      input.messageId,
      input.userId,
      input.emoji,
    );
    return { message: 'Reaction added.' };
  }

  /** Remove a reaction (§B15). Removing one that isn't there is a harmless no-op (idempotent). */
  async unreact(input: ReactInput): Promise<{ message: string }> {
    requireReaction(input);
    await this.repo.removeReaction(
      input.conversationId,
      input.messageId,
      input.userId,
      input.emoji,
    );
    await this.events.reaction(
      false,
      input.conversationId,
      input.messageId,
      input.userId,
      input.emoji,
    );
    return { message: 'Reaction removed.' };
  }

  /**
   * Edit a message (§B15). Only the original sender may edit; the previous content is appended to
   * edit_history (edit indicator + compliance). Plaintext is carried on the event for search re-index
   * ONLY when server-readable — personal E2EE edits keep the server blind (§A18.2).
   */
  async edit(input: EditMessageInput): Promise<EditAck> {
    if (!input.conversationId || !input.messageId || !input.editorId || input.content == null) {
      throw new ValidationError('conversationId, messageId, editorId and content are required');
    }
    const existing = await this.repo.findById(input.conversationId, input.messageId);
    if (!existing || existing.deleted) throw new NotFoundError('Message not found');
    if (existing.sender_id !== input.editorId) {
      throw new ForbiddenError('Only the original sender may edit this message');
    }

    const editedAt = new Date().toISOString();
    const historyEntry: MessageEditHistoryEntry = {
      content: existing.content,
      edited_at: existing.edited_at ?? existing.created_at,
    };
    await this.repo.applyEdit(
      input.conversationId,
      input.messageId,
      input.content,
      historyEntry,
      editedAt,
    );

    const serverReadable = !!input.tenantId && !input.encrypted;
    const searchText =
      serverReadable && typeof input.content === 'string' ? input.content : undefined;
    const edited: MessageDoc = { ...existing, content: input.content, edited_at: editedAt };
    await this.events.edited(edited, input.tenantId ?? null, searchText);

    return { messageId: input.messageId, editedAt };
  }

  /**
   * Delete a message (§B15). scope 'me' is a per-device local hide (no tombstone, no event). scope
   * 'everyone' tombstones globally (sender-only): content cleared, doc + seq kept, message.deleted
   * emitted so every device clears it and search purges it.
   */
  async delete(input: DeleteMessageInput): Promise<{ message: string }> {
    if (!input.conversationId || !input.messageId || !input.actorId || !input.scope) {
      throw new ValidationError('conversationId, messageId, actorId and scope are required');
    }
    if (input.scope === 'me') {
      await this.repo.deleteForMe(input.conversationId, input.messageId, input.actorId);
      return { message: 'Message hidden for you.' };
    }
    // scope === 'everyone' → sender-only global tombstone.
    const existing = await this.repo.findById(input.conversationId, input.messageId);
    if (!existing) throw new NotFoundError('Message not found');
    if (existing.sender_id !== input.actorId) {
      throw new ForbiddenError('Only the original sender may delete this message for everyone');
    }
    await this.repo.tombstone(input.conversationId, input.messageId);
    await this.events.deleted(input.conversationId, input.messageId, existing.seq);
    return { message: 'Message deleted for everyone.' };
  }
}

function requireReaction(input: ReactInput): void {
  if (!input.conversationId || !input.messageId || !input.userId || !input.emoji) {
    throw new ValidationError('conversationId, messageId, userId and emoji are required');
  }
}

function ack(m: MessageDoc): SendAck {
  return { messageId: m._id, seq: m.seq, serverTs: m.server_ts };
}
