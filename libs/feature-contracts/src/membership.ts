/**
 * Who belongs to a conversation.
 *
 * This is the one question several features need to ask about a domain they do not own: realtime
 * needs it to fan a message out, and to reject a `delivered`/`read`/`typing` frame for a
 * conversation the sender is not in (DEF-07). Rather than let those features import the
 * group-channel feature — which would weld the 6-service topology in place — they depend on this
 * port, and the composition root decides whether it is answered over HTTP or in-process.
 */
export interface MembershipResolver {
  /** Member account ids, or `[]` when they cannot be determined. */
  members(conversationId: string): Promise<string[]>;
  /** Authorization answer. Never `true` unless positively confirmed. */
  isMember(conversationId: string, userId: string): Promise<boolean>;
}

export interface HttpMembershipResolverOptions {
  /** Base URL of the service that owns conversations. From configuration ONLY — never a request. */
  baseUrl: string;
  /** Shared secret for service-to-service calls, sent as `x-velchat-internal`. */
  secret: string;
  /** Upstream budget. Exceeding it is treated as an upstream failure. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * HTTP implementation, talking to whichever service owns conversations.
 *
 * Failure semantics are deliberately asymmetric:
 *
 *  - `isMember` fails **closed**. It answers an authorization question, and an answer that could
 *    not be obtained must not read as permission.
 *  - `members` fails **empty**. It drives live fan-out, which is best-effort by design: the
 *    client's `afterSeq` catch-up is the durability backstop, so an empty list delays a message
 *    but cannot lose one. Throwing here would take down the consumer instead.
 *
 * Concurrent lookups of the same conversation share one request. Without that, a cold projection
 * on a busy conversation turns one Redis miss into hundreds of simultaneous upstream calls.
 */
export class HttpMembershipResolver implements MembershipResolver {
  private readonly inflight = new Map<string, Promise<string[]>>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: HttpMembershipResolverOptions) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      // The base URL comes from configuration, but validating it keeps a mis-set env var from
      // turning this client into an SSRF primitive (file:, gopher:, …).
      throw new Error(`MembershipResolver baseUrl must be http(s), got "${url.protocol}"`);
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async members(conversationId: string): Promise<string[]> {
    const existing = this.inflight.get(conversationId);
    if (existing) return existing;

    const work = this.fetchMembers(conversationId).finally(() => {
      this.inflight.delete(conversationId);
    });
    this.inflight.set(conversationId, work);
    return work;
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    if (!conversationId || !userId) return false;
    const members = await this.members(conversationId);
    return members.includes(userId);
  }

  private async fetchMembers(conversationId: string): Promise<string[]> {
    // encodeURIComponent, not interpolation: a conversation id is caller-supplied and must not be
    // able to walk the path.
    const url = `${this.baseUrl}/conversations/${encodeURIComponent(conversationId)}/members`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'error', // a redirect would move the secret to an unintended host
        headers: { 'x-velchat-internal': this.opts.secret },
      });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : (body as { members?: unknown })?.members;
      return Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string') : [];
    } catch {
      return []; // timeout, abort, DNS, connection refused — all "unknown", never "allowed"
    } finally {
      clearTimeout(timer);
    }
  }
}
