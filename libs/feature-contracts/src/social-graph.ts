/**
 * How a viewer relates to a content owner, as far as visibility is concerned.
 *
 * This is the one question feature-status needs about a domain it does not own. Rather than let it
 * import feature-user — which would weld the 6-service topology in place — it depends on this port,
 * and the composition root decides how the question is answered.
 */
export interface SocialRelationship {
  /** `viewer` is in `owner`'s contact list. */
  isContact: boolean;
  /** Either party has blocked the other. */
  isBlocked: boolean;
}

export interface SocialGraphResolver {
  relationship(owner: string, viewer: string): Promise<SocialRelationship>;
}

export interface HttpSocialGraphResolverOptions {
  /** Base URL of the service that owns the directory. From configuration ONLY — never a request. */
  baseUrl: string;
  /** Shared secret for service-to-service calls, sent as `x-velchat-internal`. */
  secret: string;
  /** Upstream budget. Exceeding it is treated as an upstream failure. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Denied, and the reason we could not confirm otherwise is irrelevant to the caller. */
const DENY: SocialRelationship = { isContact: false, isBlocked: true };

interface ContactRow {
  contact_user_id: string;
  blocked: boolean;
}

/**
 * HTTP implementation, talking to whichever service owns the directory.
 *
 * Fails **closed**, unlike `MembershipResolver.members()` which fails empty. That asymmetry is
 * deliberate: `members` drives best-effort live fan-out with a durable cursor catch-up behind it, so
 * an empty answer delays a message but cannot lose one. Here there is no backstop — an answer that
 * could not be obtained must not read as permission.
 *
 * Concurrent lookups of the same owner share one request. Without that, one cold cache on a popular
 * author turns a single miss into hundreds of simultaneous upstream calls.
 */
export class HttpSocialGraphResolver implements SocialGraphResolver {
  private readonly inflight = new Map<string, Promise<ContactRow[] | null>>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: HttpSocialGraphResolverOptions) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      // Validating a configured URL keeps a mis-set env var from turning this client into an
      // SSRF primitive (file:, gopher:, …).
      throw new Error(`SocialGraphResolver baseUrl must be http(s), got "${url.protocol}"`);
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async relationship(owner: string, viewer: string): Promise<SocialRelationship> {
    if (!owner || !viewer) return DENY;

    const [contacts, viewerBlockedOwner] = await Promise.all([
      this.contactsOf(owner),
      this.hasBlocked(viewer, owner),
    ]);

    // Either lookup failing means we cannot answer, so we deny.
    if (contacts === null || viewerBlockedOwner === null) return DENY;

    const row = contacts.find((c) => c.contact_user_id === viewer);
    return {
      isContact: row !== undefined,
      isBlocked: viewerBlockedOwner || (row?.blocked ?? false),
    };
  }

  /** The owner's contact list, or `null` when it could not be determined. */
  private contactsOf(owner: string): Promise<ContactRow[] | null> {
    const existing = this.inflight.get(owner);
    if (existing) return existing;

    const work = this.fetchContacts(owner).finally(() => this.inflight.delete(owner));
    this.inflight.set(owner, work);
    return work;
  }

  private async fetchContacts(owner: string): Promise<ContactRow[] | null> {
    const body = await this.get(`/users/${encodeURIComponent(owner)}/contacts`);
    if (body === null) return null;
    const data = unwrap(body);
    if (!Array.isArray(data)) return null;
    return data.flatMap((row) => {
      const r = row as Partial<ContactRow>;
      return typeof r.contact_user_id === 'string'
        ? [{ contact_user_id: r.contact_user_id, blocked: r.blocked === true }]
        : [];
    });
  }

  /** Has `owner` blocked `other`? `null` when it could not be determined. */
  private async hasBlocked(owner: string, other: string): Promise<boolean | null> {
    const body = await this.get(
      `/users/${encodeURIComponent(owner)}/contacts/${encodeURIComponent(other)}/blocked`,
    );
    if (body === null) return null;
    const data = unwrap(body);
    if (data === null || typeof data !== 'object') return null;
    return (data as { blocked?: unknown }).blocked === true;
  }

  /** GET with timeout + internal secret. `null` on any failure — callers translate that to a deny. */
  private async get(path: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        redirect: 'error', // a redirect would move the secret to an unintended host
        headers: { 'x-velchat-internal': this.opts.secret },
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null; // timeout, abort, DNS, connection refused — all "unknown", never "allowed"
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Unwrap the standard `{ success, statusCode, message, data }` response envelope. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}
