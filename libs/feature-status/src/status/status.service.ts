import {
  uuidv7,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  RateLimitError,
} from '@velchat/common';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusRepository, type ViewerPage } from './status.repository';
import { StatusEvents } from './status.events';
import {
  canView,
  STATUS_TTL_MS,
  type Audience,
  type NewStatus,
  type StatusKind,
  type StatusPost,
} from './status.types';

/** Everything about a new status EXCEPT who is posting it — that comes from the verified token. */
export interface PostStatusInput {
  kind: StatusKind;
  mediaId?: string;
  /** Ciphertext for personal (e2ee) status — the server never sees plaintext. */
  text?: string;
  bg?: string;
  caption?: string;
  audience?: Audience;
  e2ee?: boolean;
  viewOnce?: boolean;
}

const MAX_VIEWER_PAGE = 100;
const DEFAULT_VIEWER_PAGE = 50;
const AUDIENCE_MODES = new Set(['contacts', 'except', 'only']);

/** Structural subset of RateLimiter — kept local so this lib need not depend on @velchat/cache. */
export interface StatusRateLimiter {
  allow(key: string, limit: number, windowSec: number): Promise<boolean>;
}

export interface StatusThrottle {
  limiter: StatusRateLimiter;
  limits?: { create?: number; view?: number; react?: number };
}

const THROTTLE_WINDOW_SEC = 60;
const DEFAULT_LIMITS = { create: 30, view: 600, react: 120 } as const;

/**
 * Status / stories (§B8 / §C11).
 *
 * Two rules hold this together. First, the acting account is always a parameter supplied by the
 * controller from the verified token — never a field the caller can set; that is what closes the
 * IDOR and impersonation bypasses. Second, visibility is decided live against the author's current
 * social graph through the SocialGraphResolver port, which fails closed, so a contact removal or a
 * new block takes effect immediately and an unreachable directory denies rather than allows.
 *
 * Personal status content is E2EE: `text`/`caption` are ciphertext the server stores and never
 * parses, and no content field is ever put on the event bus or into a log.
 */
export class StatusService {
  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
    private readonly social: SocialGraphResolver,
    private readonly throttle?: StatusThrottle,
  ) {}

  /**
   * Abuse control, NOT authorization — so it fails OPEN. A Valkey outage must not stop people
   * posting. requireVisible fails closed instead, and that asymmetry is the point: an unobtainable
   * authorization answer must never read as permission, while an unobtainable quota reading should
   * not take the feature down.
   */
  private async guard(action: 'create' | 'view' | 'react', accountId: string): Promise<void> {
    if (!this.throttle) return;
    const limit = this.throttle.limits?.[action] ?? DEFAULT_LIMITS[action];
    let allowed = true;
    try {
      allowed = await this.throttle.limiter.allow(
        `status:${action}:${accountId}`,
        limit,
        THROTTLE_WINDOW_SEC,
      );
    } catch {
      return; // limiter unavailable → allow
    }
    if (!allowed) throw new RateLimitError(`status ${action} rate limit exceeded`);
  }

  async post(
    actingAccountId: string,
    input: PostStatusInput,
  ): Promise<{ statusId: string; expiresAt: string }> {
    if (!actingAccountId) throw new ForbiddenError('authentication required');
    await this.guard('create', actingAccountId);
    if (!input.kind) throw new ValidationError('kind is required');
    if (input.kind === 'text' && !input.text) {
      throw new ValidationError('text status requires text');
    }
    if (input.kind !== 'text' && !input.mediaId) {
      throw new ValidationError(`${input.kind} status requires mediaId`);
    }

    const rule = normaliseAudience(input.audience);
    const statusId = uuidv7();
    // Server time only. A client-supplied expiry would let a caller pin a status forever.
    const expiresAt = new Date(Date.now() + STATUS_TTL_MS);

    const post: NewStatus = {
      userId: actingAccountId,
      kind: input.kind,
      mediaId: input.mediaId ?? null,
      text: input.text ?? null,
      bg: input.bg ?? null,
      caption: input.caption ?? null,
      audience: rule,
      e2ee: input.e2ee ?? true,
      viewOnce: input.viewOnce ?? false,
    };
    await this.repo.create(statusId, post, expiresAt);

    // No content in the payload — the E2EE boundary (§3.7).
    await this.events.statusPosted(statusId, actingAccountId, input.kind, expiresAt.toISOString());
    return { statusId, expiresAt: expiresAt.toISOString() };
  }

  /** Record a view. Idempotent at the repository's primary key, so extra devices cannot inflate it. */
  async view(statusId: string, actingAccountId: string): Promise<void> {
    await this.guard('view', actingAccountId);
    const post = await this.requireVisible(statusId, actingAccountId);
    if (actingAccountId !== post.user_id) await this.repo.recordView(statusId, actingAccountId);
  }

  async react(statusId: string, actingAccountId: string, emoji: string): Promise<void> {
    if (!emoji) throw new ValidationError('emoji is required');
    await this.guard('react', actingAccountId);
    await this.requireVisible(statusId, actingAccountId);
    await this.repo.react(statusId, actingAccountId, emoji);
  }

  /** Viewer list — the author only (§B8), cursor-paginated. */
  async viewers(
    statusId: string,
    actingAccountId: string,
    limit = DEFAULT_VIEWER_PAGE,
    after?: string,
  ): Promise<{
    viewers: Array<{ viewerId: string; viewedAt: string }>;
    nextCursor: string | null;
  }> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (post.user_id !== actingAccountId) {
      throw new ForbiddenError('only the author can see viewers');
    }
    const page: ViewerPage = await this.repo.viewersPage(statusId, clampLimit(limit), after);
    return {
      viewers: page.viewers.map((v) => ({ viewerId: v.viewer_id, viewedAt: v.viewed_at })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * An author's active statuses that the caller may see, oldest first for sequential playback.
   * The relationship is resolved ONCE for the author, not per status — no N+1.
   */
  async feedOf(authorId: string, actingAccountId: string): Promise<Array<Record<string, unknown>>> {
    const posts = await this.repo.listActiveByUser(authorId);
    if (posts.length === 0) return [];

    const rel =
      authorId === actingAccountId
        ? { isContact: true, isBlocked: false }
        : await this.social.relationship(authorId, actingAccountId);

    return posts
      .filter((p) => canView({ audience: p.audience, authorId: p.user_id }, actingAccountId, rel))
      .map(toWireStatus);
  }

  async remove(statusId: string, actingAccountId: string): Promise<void> {
    // Ownership lives in the UPDATE predicate, so "not yours" and "not there" are indistinguishable
    // to the caller — deliberately, so this cannot be used to probe for others' status ids.
    if (!(await this.repo.softDelete(statusId, actingAccountId))) {
      throw new NotFoundError('status not found or not yours');
    }
  }

  /** Fetch + authorize in one place, so no read path can forget the check. */
  private async requireVisible(statusId: string, viewerId: string): Promise<StatusPost> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (post.user_id === viewerId) return post;

    const rel = await this.social.relationship(post.user_id, viewerId);
    if (!canView({ audience: post.audience, authorId: post.user_id }, viewerId, rel)) {
      throw new ForbiddenError('not in this status audience');
    }
    return post;
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_VIEWER_PAGE;
  return Math.min(Math.trunc(limit), MAX_VIEWER_PAGE);
}

/** Reject an unknown mode rather than silently falling back to a wider audience. */
function normaliseAudience(audience: Audience | undefined): Audience {
  if (!audience) return { mode: 'contacts' };
  if (!AUDIENCE_MODES.has(audience.mode)) {
    throw new ValidationError('audience.mode must be contacts, except or only');
  }
  const list = audience.list ?? [];
  if (audience.mode === 'only' && list.length === 0) {
    throw new ValidationError('audience.mode "only" requires a non-empty list');
  }
  return audience.mode === 'contacts' ? { mode: 'contacts' } : { mode: audience.mode, list };
}

function toWireStatus(p: StatusPost): Record<string, unknown> {
  return {
    statusId: p.status_id,
    authorId: p.user_id,
    kind: p.kind,
    mediaId: p.media_id,
    text: p.text, // ciphertext for personal — opaque to the server
    bg: p.bg,
    caption: p.caption,
    viewOnce: p.view_once,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
  };
}
