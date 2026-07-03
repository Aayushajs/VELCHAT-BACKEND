import type { EventBus } from '@velchat/event-bus';
import type { MessageSentPayload } from '@velchat/shared-types';
import { SearchService } from './search.service';

const GROUP = 'search-indexer';

/**
 * Indexes server-readable content from the event stream (§A18.1). Only messages carrying a
 * `tenant_id` (enterprise/workspace channels) are indexed — personal E2EE messages have no tenant
 * and are never indexed server-side (searched on-device, §A18.2).
 */
export class SearchConsumer {
  constructor(
    private readonly bus: EventBus,
    private readonly service: SearchService,
  ) {}

  register(): void {
    this.bus.subscribe<MessageSentPayload>('message.sent', GROUP, async (e) => {
      if (!e.tenant_id) return; // personal/E2EE → not indexed server-side
      await this.service.indexMessage({
        messageId: e.payload.message_id,
        tenantId: e.tenant_id,
        conversationId: e.payload.conversation_id,
        senderId: e.payload.sender_account_id,
        seq: e.payload.seq,
        sentAt: e.payload.sent_at,
        // Body text is added once chat-service carries plaintext for server-readable convs; metadata
        // (sender/channel/date) is searchable now via filters.
      });
    });
  }
}
