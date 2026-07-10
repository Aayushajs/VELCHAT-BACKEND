import type { EventBus } from '@velchat/event-bus';
import type {
  MessageSentPayload,
  FileUploadedPayload,
  FileDeletedPayload,
  ConversationCreatedPayload,
  ChannelUpdatedPayload,
  MemberAddedPayload,
  UserCreatedPayload,
} from '@velchat/shared-types';
import { SearchService } from './search.service';

const GROUP = 'search-indexer';

/**
 * Builds the OpenSearch/Atlas indexes purely from the event stream (§A18.1 / §A10.5). Only
 * server-readable content carrying a `tenant_id` (enterprise/workspace) is indexed — personal E2EE
 * content has no tenant and is never indexed server-side (searched on-device, §A18.2).
 */
export class SearchConsumer {
  constructor(
    private readonly bus: EventBus,
    private readonly service: SearchService,
  ) {}

  register(): void {
    // ── messages ──
    this.bus.subscribe<MessageSentPayload>('message.sent', GROUP, async (e) => {
      if (!e.tenant_id) return; // personal/E2EE → not indexed server-side
      await this.service.indexMessage({
        messageId: e.payload.message_id,
        tenantId: e.tenant_id,
        conversationId: e.payload.conversation_id,
        senderId: e.payload.sender_account_id,
        seq: e.payload.seq,
        sentAt: e.payload.sent_at,
        // Plaintext body for server-readable (enterprise/channel) messages → full-text searchable.
        // Personal E2EE messages never carry `text`, so only their metadata is ever indexed.
        text: e.payload.text,
      });
    });

    // ── files ──
    this.bus.subscribe<FileUploadedPayload>('file.uploaded', GROUP, async (e) => {
      if (!e.tenant_id || e.payload.encrypted || !e.payload.conversation_id) return; // E2EE/personal → skip
      await this.service.indexFile({
        mediaId: e.payload.media_id,
        tenantId: e.tenant_id,
        conversationId: e.payload.conversation_id,
        ownerId: e.payload.owner_id,
        mime: e.payload.mime,
        uploadedAt: e.payload.uploaded_at,
      });
    });
    this.bus.subscribe<FileDeletedPayload>('file.deleted', GROUP, async (e) => {
      if (!e.tenant_id) return;
      await this.service.removeFile(e.payload.media_id, e.tenant_id);
    });

    // ── channels ──
    this.bus.subscribe<ConversationCreatedPayload>('conversation.created', GROUP, async (e) => {
      if (!e.tenant_id || e.payload.type !== 'channel') return; // only tenant channels are discoverable
      await this.service.indexChannel({
        channelId: e.payload.conversation_id,
        tenantId: e.tenant_id,
        name: e.payload.name,
        visibility: e.payload.visibility,
      });
    });
    this.bus.subscribe<ChannelUpdatedPayload>('channel.updated', GROUP, async (e) => {
      const tenantId = e.tenant_id ?? e.payload.tenant_id;
      if (!tenantId) return;
      await this.service.indexChannel({
        channelId: e.payload.conversation_id,
        tenantId,
        name: e.payload.name,
        topic: e.payload.topic,
        visibility: e.payload.visibility,
      });
    });

    // ── people (org directory) ──
    // Members joining a tenant → index them for people search. displayName is enriched when the
    // user profile carries it (additive contract); id + tenant make the person discoverable now.
    this.bus.subscribe<MemberAddedPayload>('member.added', GROUP, async (e) => {
      // Only org/workspace scopes form a searchable directory (a team lives inside an org).
      if (e.payload.scope_type !== 'org' && e.payload.scope_type !== 'workspace') return;
      await this.service.indexUser({
        userId: e.payload.user_id,
        tenantId: e.payload.scope_id,
      });
    });
    this.bus.subscribe<UserCreatedPayload>('user.created', GROUP, async (e) => {
      if (!e.payload.tenant_id) return; // personal-graph users aren't in a server-side directory
      await this.service.indexUser({
        userId: e.payload.account_id,
        tenantId: e.payload.tenant_id,
      });
    });
  }
}
