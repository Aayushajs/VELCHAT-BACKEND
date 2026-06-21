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
  deleted: boolean;
  deleted_scope: 'me' | 'everyone' | null;
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
}

export interface SendAck {
  messageId: string;
  seq: number;
  serverTs: string;
}
