import type { Redis } from 'ioredis';
import { extractMemberIds } from '@velchat/feature-contracts';

/**
 * Event-sourced membership projection (§A10.5) with HTTP auto-heal fallback. realtime-gw keeps
 * `members:{conv}` as a Valkey set, fed by conversation.created / channel.member.* events. When
 * the set is empty (Redis restart, cold start, missed event), a single-flight HTTP fallback to
 * group-channel-service resolves the members, repopulates the projection, and returns them —
 * so fan-out never silently drops a message because of a stale cache.
 *
 * The HTTP fallback is bounded (5s timeout, no retry) and protected by a single-flight map
 * (concurrent requests for the same conversationId share one HTTP call) to prevent stampedes.
 */
export class MembershipProjection {
  /** Single-flight map: conversationId → in-progress HTTP fetch promise. */
  private readonly inflight = new Map<string, Promise<string[]>>();

  /**
   * @param redis      The shared Valkey client.
   * @param fallbackUrl Base URL of the service that owns conversations — identity-service under
   *                    the 6-service topology (e.g. `http://localhost:3002`), injected by the
   *                    composition root from `UPSTREAM_IDENTITY`.
   *                    When undefined, fallback is disabled (tests / dev without group-channel).
   * @param internalSecret `INTERNAL_API_SECRET` — REQUIRED for the fallback to work at all.
   *                    `GET /conversations/:id/members` is `@AllowInternal()`, i.e. it accepts a
   *                    service secret INSTEAD of a user JWT — but it is still guarded. Calling it
   *                    with neither returns 401, which this class reads as "no members" and turns
   *                    into a silently dropped fan-out. Without this the auto-heal cannot heal.
   */
  constructor(
    private readonly redis: Redis,
    private readonly fallbackUrl?: string,
    private readonly internalSecret?: string,
  ) {}

  private key(conversationId: string): string {
    return `members:${conversationId}`;
  }

  async seed(conversationId: string, memberIds: string[]): Promise<void> {
    if (memberIds.length === 0) return;
    await this.redis.sadd(this.key(conversationId), ...memberIds);
  }

  async add(conversationId: string, userId: string): Promise<void> {
    await this.redis.sadd(this.key(conversationId), userId);
  }

  async remove(conversationId: string, userId: string): Promise<void> {
    await this.redis.srem(this.key(conversationId), userId);
  }

  /**
   * Resolve conversation members. Primary: Redis `SMEMBERS`. Fallback (when empty): single-flight
   * HTTP to group-channel-service → repopulate Redis → return. If fallback also fails, returns `[]`
   * (cursor catch-up is the durability backstop for missed live pushes).
   */
  async members(conversationId: string): Promise<string[]> {
    const cached = await this.redis.smembers(this.key(conversationId));
    if (cached.length > 0) return cached;

    // No fallback configured → return empty (dev / test)
    if (!this.fallbackUrl) return [];

    return this.fetchAndSeed(conversationId);
  }

  /**
   * Authorization answer for `WsFabric.mayAct()` — the {@link MembershipResolver} port.
   *
   * Fails CLOSED: `members()` yields `[]` for both "cold and unresolvable" and "genuinely empty",
   * and neither is grounds to let a socket act on a conversation. Backed by the Valkey set (and
   * its HTTP auto-heal), so authorizing a frame is a local set read, not a per-frame HTTP call.
   */
  async isMember(conversationId: string, userId: string): Promise<boolean> {
    if (!conversationId || !userId) return false;
    const members = await this.members(conversationId);
    return members.includes(userId);
  }

  /**
   * Single-flight HTTP fallback: only one in-progress fetch per conversationId. Concurrent
   * callers share the same promise. On success, the Redis set is repopulated so future lookups
   * are instant. On failure, returns [] (bounded — no infinite retry).
   */
  private fetchAndSeed(conversationId: string): Promise<string[]> {
    const existing = this.inflight.get(conversationId);
    if (existing) return existing;

    const work = this.doFetch(conversationId).finally(() => {
      this.inflight.delete(conversationId);
    });

    this.inflight.set(conversationId, work);
    return work;
  }

  private async doFetch(conversationId: string): Promise<string[]> {
    try {
      const url = `${this.fallbackUrl}/conversations/${encodeURIComponent(conversationId)}/members`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          redirect: 'error', // a redirect would carry the secret to an unintended host
          headers: this.internalSecret ? { 'x-velchat-internal': this.internalSecret } : {},
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) return [];
      const body: unknown = await res.json();
      // The upstream answers with the standard success envelope (`{ data: [...] }`), not a bare
      // array — reading only the array yields [] and re-drops the very message we came to heal.
      const members = extractMemberIds(body);
      if (members.length > 0) {
        await this.redis.sadd(this.key(conversationId), ...members);
      }
      return members;
    } catch {
      // Bounded failure — don't retry; cursor catch-up covers missed live pushes.
      return [];
    }
  }
}
