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

/** A contact was added to a user's list (§B3) → search (personal contact index). */
export interface ContactAddedPayload {
  user_id: AccountId;
  contact_user_id: AccountId;
  added_at: Iso8601;
}

/** A tenant scope (org/workspace/team). */
export type ScopeType = 'org' | 'workspace' | 'team';
export type TenantRole = 'owner' | 'admin' | 'member' | 'guest' | 'bot';

export interface OrgCreatedPayload {
  org_id: TenantId;
  name: string;
  created_by: AccountId;
  created_at: Iso8601;
}

/** A user was added to a tenant scope (§B3) → notification, search (directory), cache. */
export interface MemberAddedPayload {
  scope_type: ScopeType;
  scope_id: TenantId;
  user_id: AccountId;
  role: TenantRole;
  added_at: Iso8601;
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

/** Group Sender-Key epoch rotated on a membership change (§G1-2) — clients redistribute keys. */
export interface GroupEpochChangedPayload {
  conversation_id: ConversationId;
  epoch: number;
  /** Why the epoch rotated — drives client UX/telemetry. */
  reason: 'member.added' | 'member.removed';
  changed_at: Iso8601;
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

/** Emitted when a media blob is stored (§B11). For personal media the bytes are ciphertext. */
export interface FileUploadedPayload {
  media_id: string;
  owner_id: AccountId;
  conversation_id: string | null;
  tenant_id: TenantId | null;
  mime: string | null;
  size: number | null;
  content_hash: string;
  encrypted: boolean;
  uploaded_at: Iso8601;
}

/** A status/story was posted (§B8/§C11) → realtime rings only the audience members. */
export interface StatusPostedPayload {
  status_id: string;
  user_id: AccountId;
  kind: 'text' | 'image' | 'video' | 'voice';
  /** Audience account_ids the post is visible to (resolved server-side from the audience rule). */
  audience: AccountId[];
  expires_at: Iso8601;
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
  'group.epoch.changed': GroupEpochChangedPayload;
  'message.sent': MessageSentPayload;
  'message.delivered': MessageReceiptPayload;
  'message.read': MessageReceiptPayload;
  'file.uploaded': FileUploadedPayload;
  'status.posted': StatusPostedPayload;
  'org.created': OrgCreatedPayload;
  'member.added': MemberAddedPayload;
  'contact.added': ContactAddedPayload;
  'presence.changed': PresenceChangedPayload;
}

export type EventTopic = keyof EventPayloads;
