import type { Redis } from 'ioredis';

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
   */
  constructor(
    private readonly redis: Redis,
    private readonly fallbackUrl?: string,
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
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) return [];
      const body: unknown = await res.json();
      const members = Array.isArray(body)
        ? body.filter((m): m is string => typeof m === 'string')
        : [];
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
