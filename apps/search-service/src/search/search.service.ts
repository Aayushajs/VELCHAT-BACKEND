import type { SearchIndex, SearchHit } from '@velchat/search';
import { parseQuery, allowedHit, matchesFilters } from './search-query';

export interface QueryContext {
  tenantId: string;
  /** Channels the caller can access — injected server-side from membership (never client-supplied). */
  accessibleChannelIds: string[];
  limit?: number;
}

const MESSAGES = 'messages';

/**
 * Search query + indexing (§A18 / §B13). Personal E2EE content is NEVER indexed server-side (only
 * enterprise/channel docs that carry a tenant); those are searched on-device (§A18.2). Every query is
 * tenant-scoped by the index and then ACL-filtered to the caller's accessible channels (§G6-3).
 */
export class SearchService {
  constructor(private readonly index: SearchIndex) {}

  /** Index a server-readable message (enterprise/channel only — caller passes tenantId). */
  async indexMessage(doc: {
    messageId: string;
    tenantId: string;
    conversationId: string;
    senderId: string;
    seq: number;
    sentAt: string;
    text?: string;
  }): Promise<void> {
    await this.index.index(MESSAGES, {
      id: doc.messageId,
      tenantId: doc.tenantId,
      conversationId: doc.conversationId,
      senderId: doc.senderId,
      seq: doc.seq,
      sentAt: doc.sentAt,
      text: doc.text ?? '',
    });
  }

  async removeMessage(messageId: string, tenantId: string): Promise<void> {
    await this.index.remove(MESSAGES, messageId, tenantId);
  }

  /**
   * Run a query: parse filters → tenant-scoped index search → ACL + filter the hits. Over-fetches so
   * post-filtering still returns a full page.
   */
  async query(raw: string, ctx: QueryContext): Promise<SearchHit[]> {
    const limit = ctx.limit ?? 20;
    const { text, filters } = parseQuery(raw);
    const accessible = new Set(ctx.accessibleChannelIds);
    const hits = await this.index.search(MESSAGES, text, ctx.tenantId, limit * 4);
    return hits
      .filter((h) => allowedHit(h.doc, accessible) && matchesFilters(h.doc, filters))
      .slice(0, limit);
  }
}
