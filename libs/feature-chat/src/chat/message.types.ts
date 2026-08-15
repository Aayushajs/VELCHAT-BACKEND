export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'location'
  | 'contact'
  | 'poll'
  | 'system';

export interface Mention {
  user_id: string;
  type: 'user' | 'channel' | 'here' | 'everyone';
}

/** A prior version of a message, kept for the edit indicator + compliance edit history (§B15). */
export interface MessageEditHistoryEntry {
  content: string | Record<string, unknown>;
  edited_at: string;
}

export type DeleteScope = 'me' | 'everyone';

/**
 * Message document (§B4.1, MongoDB). `content` is OPAQUE: an E2EE ciphertext blob for personal
 * conversations (the server never reads it) or plaintext for enterprise channels.
 */
export interface MessageDoc {
  _id: string; // UUIDv7
  conversation_id: string;
  seq: number; // server-monotonic per conversation (total order)
  sender_id: string;
  client_msg_id: string; // dedupe / optimistic UI
  type: MessageType;
  content: string | Record<string, unknown>;
  reply_to: string | null;
  thread_root: string | null;
  mentions: Mention[];
  attachments: Array<Record<string, unknown>>;
  reactions: Record<string, string[]>;
  edited_at: string | null;
  edit_history: MessageEditHistoryEntry[];
  deleted: boolean;
  deleted_scope: DeleteScope | null;
  /** Per-user "delete for me" hides — local/per-device, never a global tombstone (§B15). */
  deleted_for?: string[];
  ephemeral_ttl: number | null;
  created_at: string;
  server_ts: string;
}

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  clientMsgId: string;
  type?: MessageType;
  content: string | Record<string, unknown>;
  replyTo?: string;
  threadRoot?: string;
  mentions?: Mention[];
  /**
   * Owning tenant for enterprise/workspace channel messages. Present ⇒ server-readable; the message
   * is eligible for full-text indexing + mention routing. Absent ⇒ personal (E2EE), never indexed.
   */
  tenantId?: string | null;
  /** True for personal E2EE — `content` is opaque ciphertext; never indexed/translated server-side. */
  encrypted?: boolean;
}

export interface SendAck {
  messageId: string;
  seq: number;
  serverTs: string;
}

/** Add/remove a reaction on a message (§B15). Idempotent per (user, emoji). */
export interface ReactInput {
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

/** Edit a message (§B15). Sender-only. `content` stays opaque (ciphertext for personal E2EE). */
export interface EditMessageInput {
  conversationId: string;
  messageId: string;
  editorId: string;
  content: string | Record<string, unknown>;
  /** Present ⇒ server-readable; the new plaintext is carried for search re-index. Absent ⇒ personal. */
  tenantId?: string | null;
  /** True for personal E2EE — content is opaque ciphertext; never indexed server-side. */
  encrypted?: boolean;
}

/** Delete a message (§B15). scope 'me' hides per-device; 'everyone' tombstones (sender-only). */
export interface DeleteMessageInput {
  conversationId: string;
  messageId: string;
  actorId: string;
  scope: DeleteScope;
}

export interface EditAck {
  messageId: string;
  editedAt: string;
}
