import { uuidv7, ValidationError, NotFoundError, ForbiddenError } from '@velchat/common';
import { StatusRepository } from './status.repository';
import { StatusEvents } from './status.events';
import {
  audienceAllows,
  STATUS_TTL_MS,
  type Audience,
  type NewStatus,
  type StatusKind,
} from './status.types';

export interface PostStatusInput {
  userId: string;
  kind: StatusKind;
  mediaId?: string;
  /** Ciphertext for personal (e2ee) status — the server never sees plaintext. */
  text?: string;
  bg?: string;
  caption?: string;
  audience?: Audience;
  /** The author's contact account_ids — used to resolve the audience server-side. */
  contacts?: string[];
  e2ee?: boolean;
  viewOnce?: boolean;
}

/**
 * Status / stories (§B8 / §C11). The audience rule + the author's contacts resolve to a concrete
 * set; the post stores that set and the realtime ring goes only to those members. Personal status
 * is E2EE (audience-encrypted by the client) — the server holds ciphertext + the audience set only.
 */
export class StatusService {
  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
  ) {}

  async post(
    input: PostStatusInput,
  ): Promise<{ statusId: string; audience: string[]; expiresAt: string }> {
    if (!input.userId) throw new ValidationError('userId is required');
    const rule: Audience = input.audience ?? { mode: 'contacts' };
    const contacts = new Set(input.contacts ?? []);
    // Resolve the rule to a concrete audience (for 'only', the list itself; else filtered contacts).
    const resolved =
      rule.mode === 'only'
        ? (rule.list ?? [])
        : [...contacts].filter((c) => audienceAllows(rule, c, contacts));

    const statusId = uuidv7();
    const expiresAt = new Date(Date.now() + STATUS_TTL_MS);
    const post: NewStatus = {
      userId: input.userId,
      kind: input.kind,
      mediaId: input.mediaId ?? null,
      text: input.text ?? null,
      bg: input.bg ?? null,
      caption: input.caption ?? null,
      audience: { mode: rule.mode, list: resolved },
      e2ee: input.e2ee ?? true,
      viewOnce: input.viewOnce ?? false,
    };
    await this.repo.create(statusId, post, expiresAt);
    await this.events.statusPosted(
      statusId,
      input.userId,
      input.kind,
      resolved,
      expiresAt.toISOString(),
    );
    return { statusId, audience: resolved, expiresAt: expiresAt.toISOString() };
  }

  /** Record a view — only if the viewer is in the audience (or is the author). */
  async view(statusId: string, viewerId: string): Promise<void> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (viewerId !== post.user_id && !inAudience(post.audience, viewerId)) {
      throw new ForbiddenError('not in this status audience');
    }
    if (viewerId !== post.user_id) await this.repo.recordView(statusId, viewerId);
  }

  async react(statusId: string, viewerId: string, emoji: string): Promise<void> {
    if (!emoji) throw new ValidationError('emoji is required');
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (!inAudience(post.audience, viewerId))
      throw new ForbiddenError('not in this status audience');
    await this.repo.react(statusId, viewerId, emoji);
  }

  /** Viewer list — only the author may see who viewed (§B8). */
  async viewers(
    statusId: string,
    requesterId: string,
  ): Promise<Array<{ viewerId: string; viewedAt: string }>> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (post.user_id !== requesterId) throw new ForbiddenError('only the author can see viewers');
    return (await this.repo.viewers(statusId)).map((v) => ({
      viewerId: v.viewer_id,
      viewedAt: v.viewed_at,
    }));
  }

  /** A viewer's feed of an author's still-active statuses they're allowed to see. */
  async feedOf(authorId: string, viewerId: string): Promise<Array<Record<string, unknown>>> {
    const posts = await this.repo.listByUser(authorId);
    return posts
      .filter((p) => viewerId === p.user_id || inAudience(p.audience, viewerId))
      .map((p) => ({
        statusId: p.status_id,
        kind: p.kind,
        mediaId: p.media_id,
        text: p.text, // ciphertext for personal
        bg: p.bg,
        caption: p.caption,
        viewOnce: p.view_once,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
      }));
  }

  async remove(statusId: string, userId: string): Promise<void> {
    if (!(await this.repo.delete(statusId, userId))) {
      throw new NotFoundError('status not found or not yours');
    }
  }
}

function inAudience(audience: { list?: string[] }, viewer: string): boolean {
  return (audience.list ?? []).includes(viewer);
}
