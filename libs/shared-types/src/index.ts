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
  /** Optional discovery metadata (channels/groups) so search can index without a lookup (§A18.1). */
  name?: string | null;
  visibility?: string | null;
}

/** Channel metadata changed (§B7) → search reindex + cache invalidation. */
export interface ChannelUpdatedPayload {
  conversation_id: ConversationId;
  tenant_id?: TenantId | null;
  name?: string | null;
  topic?: string | null;
  visibility?: string | null;
  is_announcement?: boolean | null;
}

/** A media blob + metadata was removed (view-once consume / delete, §C22) → search + chat purge. */
export interface FileDeletedPayload {
  media_id: string;
  conversation_id: string | null;
  tenant_id: TenantId | null;
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
  /**
   * Plaintext body for SERVER-READABLE (enterprise/channel) messages only — powers full-text
   * search indexing (§A18). NEVER set for personal E2EE messages (the server has only ciphertext).
   */
  text?: string;
  sender_account_id: AccountId;
  sent_at: Iso8601;
}

/** A reaction was added/removed on a message (§B15) → realtime fan-out to conversation members. */
export interface MessageReactionPayload {
  conversation_id: ConversationId;
  message_id: string;
  user_id: AccountId;
  emoji: string;
}

/**
 * A message was edited (§B15). `text` is carried ONLY for SERVER-READABLE (enterprise/channel) edits
 * so search can re-index; personal E2EE edits omit it (the server holds only ciphertext, §A18.2).
 */
export interface MessageEditedPayload {
  conversation_id: ConversationId;
  message_id: string;
  seq: number;
  text?: string;
  edited_at: Iso8601;
}

/** A message was deleted for everyone (tombstone, §B15) → realtime clear + search purge. */
export interface MessageDeletedPayload {
  conversation_id: ConversationId;
  message_id: string;
  seq: number;
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

/** Call/room started (§B12) → notification (ring), audit, ai (transcribe when enterprise). */
export interface CallStartedPayload {
  call_id: string;
  type: 'dm' | 'group' | 'meeting' | 'huddle';
  conversation_id: string | null;
  host_id: AccountId;
  room_name: string;
  started_at: Iso8601;
}

export interface CallEndedPayload {
  call_id: string;
  ended_at: Iso8601;
}

/** A participant joined or left a call (§B12) → realtime fan-out to the room. */
export interface CallParticipantPayload {
  call_id: string;
  user_id: AccountId;
  role: 'host' | 'cohost' | 'attendee';
  at: Iso8601;
}

/** A meeting was scheduled (§A17.3) → notification + iCal invite with a join link. */
export interface MeetingScheduledPayload {
  meeting_id: string;
  call_id: string;
  organizer_id: AccountId;
  scheduled_at: Iso8601 | null;
  invitees: AccountId[];
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

/**
 * A live translated call caption for ONE listener (§A26.3 / C20). ai-service produces it per listener
 * in their language; realtime-gateway routes it to that user's sockets so a call is subtitled (and
 * optionally spoken) in each participant's own language in near-real-time. Enterprise/server-readable
 * calls only — personal E2EE call translation runs on-device (§A26.1).
 */
export interface CallCaptionPayload {
  call_id: string;
  /** The listener this caption is for. */
  to_user_id: AccountId;
  /** The speaker. */
  from_user_id: AccountId;
  /** Caption text already translated into the listener's language. */
  text: string;
  lang: string;
  /** Partial (fast interim) vs final segment — drives sub-second incremental captions. */
  is_final: boolean;
  /** Optional TTS audio the client can play in the listener's language. */
  audio_url?: string;
  ts: Iso8601;
}

/**
 * A feature flag / remote-config entry changed (automation-service feature-flags module).
 * Carries no flag values — realtime-gateway broadcasts a compact "refetch" signal so clients
 * re-call `/feature-flags/evaluate` (§6 of docs/FEATURE-FLAGS.md). `tenant_id === null` = global
 * (platform-wide) change affecting every tenant.
 */
export interface FeatureFlagChangedPayload {
  tenant_id: TenantId | null;
  flag_key: string;
  action:
    | 'update'
    | 'enable'
    | 'disable'
    | 'rollout'
    | 'rollback'
    | 'schedule'
    | 'kill'
    | 'archive'
    | 'maintenance'
    | 'announcement';
  version: number;
}

/** Map of topic → payload type, for end-to-end type-safe producers/consumers. */
export interface EventPayloads {
  'user.created': UserCreatedPayload;
  'device.added': DeviceAddedPayload;
  'device.list.changed': DeviceListChangedPayload;
  'identifier.changed': IdentifierChangedPayload;
  'conversation.created': ConversationCreatedPayload;
  'channel.updated': ChannelUpdatedPayload;
  'channel.member.added': ChannelMemberPayload;
  'channel.member.removed': ChannelMemberPayload;
  'group.epoch.changed': GroupEpochChangedPayload;
  'message.sent': MessageSentPayload;
  'message.reaction.added': MessageReactionPayload;
  'message.reaction.removed': MessageReactionPayload;
  'message.edited': MessageEditedPayload;
  'message.deleted': MessageDeletedPayload;
  'message.delivered': MessageReceiptPayload;
  'message.read': MessageReceiptPayload;
  'file.uploaded': FileUploadedPayload;
  'file.deleted': FileDeletedPayload;
  'status.posted': StatusPostedPayload;
  'org.created': OrgCreatedPayload;
  'member.added': MemberAddedPayload;
  'contact.added': ContactAddedPayload;
  'call.started': CallStartedPayload;
  'call.ended': CallEndedPayload;
  'call.participant.joined': CallParticipantPayload;
  'call.participant.left': CallParticipantPayload;
  'meeting.scheduled': MeetingScheduledPayload;
  'presence.changed': PresenceChangedPayload;
  'featureflag.changed': FeatureFlagChangedPayload;
  'call.caption': CallCaptionPayload;
}

export type EventTopic = keyof EventPayloads;
