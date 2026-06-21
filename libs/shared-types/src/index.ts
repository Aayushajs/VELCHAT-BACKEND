/**
 * Shared, framework-agnostic type contracts.
 *
 * gRPC/proto types are generated into `./gen` by `pnpm proto:gen` (buf + ts-proto) and
 * re-exported once generated. The hand-written types below are the event payload contracts
 * (§A11) carried inside the standard envelope and a few common primitives.
 */

/** Immutable identity (§B2). Never key data on phone/email. */
export type AccountId = string; // UUIDv7
export type TenantId = string;
export type DeviceId = string;
export type ConversationId = string;

export type Iso8601 = string;

// ── Kafka event payloads (§A11) ─────────────────────────────────────────────
export interface UserCreatedPayload {
  account_id: AccountId;
  tenant_id: TenantId | null;
  created_at: Iso8601;
}

export interface DeviceAddedPayload {
  account_id: AccountId;
  device_id: DeviceId;
  trusted: boolean;
}

export interface IdentifierChangedPayload {
  account_id: AccountId;
  kind: 'phone' | 'email';
  changed_at: Iso8601;
}

/** Emitted whenever the account's device list changes (§G1-3) so senders re-fetch + re-fan-out. */
export interface DeviceListChangedPayload {
  account_id: AccountId;
  epoch: number;
  changed_at: Iso8601;
}

export interface ConversationCreatedPayload {
  conversation_id: ConversationId;
  type: 'dm' | 'group' | 'channel' | 'broadcast' | 'community';
  tenant_id: TenantId | null;
  created_by: AccountId;
  member_ids: AccountId[];
}

export interface ChannelMemberPayload {
  conversation_id: ConversationId;
  user_id: AccountId;
  role: 'owner' | 'admin' | 'member';
  tenant_id: TenantId | null;
}

export interface MessageSentPayload {
  conversation_id: ConversationId;
  message_id: string;
  seq: number;
  /** Ciphertext for personal (E2EE) conversations; the server never reads it. */
  ciphertext_ref?: string;
  sender_account_id: AccountId;
  sent_at: Iso8601;
}

/** Compact receipt covering every message up to `up_to_seq` (§B4.4). */
export interface MessageReceiptPayload {
  conversation_id: ConversationId;
  up_to_seq: number;
  /** The recipient who acknowledged (delivered/read). */
  user_id: AccountId;
  state: 'delivered' | 'read';
  at: Iso8601;
}

export interface PresenceChangedPayload {
  account_id: AccountId;
  status: 'online' | 'offline' | 'away';
  changed_at: Iso8601;
}

/** Map of topic → payload type, for end-to-end type-safe producers/consumers. */
export interface EventPayloads {
  'user.created': UserCreatedPayload;
  'device.added': DeviceAddedPayload;
  'device.list.changed': DeviceListChangedPayload;
  'identifier.changed': IdentifierChangedPayload;
  'conversation.created': ConversationCreatedPayload;
  'channel.member.added': ChannelMemberPayload;
  'channel.member.removed': ChannelMemberPayload;
  'message.sent': MessageSentPayload;
  'message.delivered': MessageReceiptPayload;
  'message.read': MessageReceiptPayload;
  'presence.changed': PresenceChangedPayload;
}

export type EventTopic = keyof EventPayloads;
