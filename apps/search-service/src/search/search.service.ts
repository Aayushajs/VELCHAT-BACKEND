import type { SearchIndex, SearchHit } from '@velchat/search';
import { parseQuery, allowedHit, matchesFilters } from './search-query';

export interface QueryContext {
  tenantId: string;
  /** Channels the caller can access — injected server-side from membership (never client-supplied). */
  accessibleChannelIds: string[];
  limit?: number;
}

const MESSAGES = 'messages';
const FILES = 'files';
const USERS = 'users';
const CHANNELS = 'channels';

/**
 * Search query + indexing (§A18 / §B13). Personal E2EE content is NEVER indexed server-side (only
 * enterprise/channel docs that carry a tenant); those are searched on-device (§A18.2). Every query is
 * tenant-scoped by the index and then ACL-filtered to the caller's accessible channels (§G6-3).
 */
export class SearchService {
  constructor(private readonly index: SearchIndex) {}

  /**
   * Index a server-readable message (enterprise/channel only — caller passes tenantId). `senderId`
   * and `sentAt` are optional so an edit re-index (message.edited carries only the new text +
   * conversation/seq metadata) can update the body without them; on the send path both are supplied.
   */
  async indexMessage(doc: {
    messageId: string;
    tenantId: string;
    conversationId: string;
    senderId?: string;
    seq: number;
    sentAt?: string;
    text?: string;
  }): Promise<void> {
    await this.index.index(MESSAGES, {
      id: doc.messageId,
      tenantId: doc.tenantId,
      conversationId: doc.conversationId,
      seq: doc.seq,
      text: doc.text ?? '',
      ...(doc.senderId !== undefined ? { senderId: doc.senderId } : {}),
      ...(doc.sentAt !== undefined ? { sentAt: doc.sentAt } : {}),
    });
  }

  async removeMessage(messageId: string, tenantId: string): Promise<void> {
    await this.index.remove(MESSAGES, messageId, tenantId);
  }

  /** Index a server-readable file/attachment (enterprise only — personal media is never indexed). */
  async indexFile(doc: {
    mediaId: string;
    tenantId: string;
    conversationId: string;
    ownerId: string;
    mime?: string | null;
    filename?: string | null;
    uploadedAt: string;
  }): Promise<void> {
    await this.index.index(FILES, {
      id: doc.mediaId,
      tenantId: doc.tenantId,
      conversationId: doc.conversationId,
      senderId: doc.ownerId,
      mime: doc.mime ?? '',
      filename: doc.filename ?? '',
      has: 'file',
      sentAt: doc.uploadedAt,
    });
  }

  async removeFile(mediaId: string, tenantId: string): Promise<void> {
    await this.index.remove(FILES, mediaId, tenantId);
  }

  /** Index a tenant channel for discovery (§B13). Public channels are searchable by anyone in the tenant. */
  async indexChannel(doc: {
    channelId: string;
    tenantId: string;
    name?: string | null;
    topic?: string | null;
    visibility?: string | null;
  }): Promise<void> {
    await this.index.index(CHANNELS, {
      id: doc.channelId,
      tenantId: doc.tenantId,
      channelId: doc.channelId,
      name: doc.name ?? '',
      topic: doc.topic ?? '',
      visibility: doc.visibility ?? 'public',
    });
  }

  async removeChannel(channelId: string, tenantId: string): Promise<void> {
    await this.index.remove(CHANNELS, channelId, tenantId);
  }

  /** Index a person in the org directory (§B13 people search). Enterprise directory only. */
  async indexUser(doc: {
    userId: string;
    tenantId: string;
    displayName?: string | null;
    handle?: string | null;
  }): Promise<void> {
    await this.index.index(USERS, {
      id: doc.userId,
      tenantId: doc.tenantId,
      userId: doc.userId,
      displayName: doc.displayName ?? '',
      handle: doc.handle ?? '',
    });
  }

  async removeUser(userId: string, tenantId: string): Promise<void> {
    await this.index.remove(USERS, userId, tenantId);
  }

  /**
   * Message search: parse filters → tenant-scoped index search → ACL + filter the hits. Over-fetches
   * so post-filtering still returns a full page.
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

  /** File search — same conversation ACL as messages (a file belongs to a conversation). */
  async queryFiles(raw: string, ctx: QueryContext): Promise<SearchHit[]> {
    const limit = ctx.limit ?? 20;
    const { text, filters } = parseQuery(raw);
    const accessible = new Set(ctx.accessibleChannelIds);
    const hits = await this.index.search(FILES, text, ctx.tenantId, limit * 4);
    return hits
      .filter((h) => allowedHit(h.doc, accessible) && matchesFilters(h.doc, filters))
      .slice(0, limit);
  }

  /**
   * Channel discovery — a hit is visible if the channel is PUBLIC or the caller is a member
   * (accessibleChannelIds). Private channels the caller isn't in are excluded (§A18.3 ACL).
   */
  async queryChannels(raw: string, ctx: QueryContext): Promise<SearchHit[]> {
    const limit = ctx.limit ?? 20;
    const { text } = parseQuery(raw);
    const accessible = new Set(ctx.accessibleChannelIds);
    const hits = await this.index.search(CHANNELS, text, ctx.tenantId, limit * 4);
    return hits
      .filter((h) => {
        const id = String(h.doc.channelId ?? h.doc.id ?? h.id);
        const visibility = String(h.doc.visibility ?? 'public');
        return visibility === 'public' || accessible.has(id);
      })
      .slice(0, limit);
  }

  /** People search — tenant-scoped org directory (tenant filter is the ACL; no channel scope). */
  async queryPeople(raw: string, tenantId: string, limit = 20): Promise<SearchHit[]> {
    const { text } = parseQuery(raw);
    return (await this.index.search(USERS, text, tenantId, limit)).slice(0, limit);
  }

  /** Typeahead across channels + people (small, low-latency) for the search box (§A18.3). */
  async suggest(
    raw: string,
    ctx: QueryContext,
  ): Promise<{ channels: SearchHit[]; people: SearchHit[] }> {
    const [channels, people] = await Promise.all([
      this.queryChannels(raw, { ...ctx, limit: 5 }),
      this.queryPeople(raw, ctx.tenantId, 5),
    ]);
    return { channels, people };
  }
}
