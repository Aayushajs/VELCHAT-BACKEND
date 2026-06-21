import type { Redis } from 'ioredis';

/**
 * Event-sourced membership projection (§A10.5). realtime-gw does not read group-channel's DB; it
 * keeps `members:{conv}` as a Valkey set, fed by conversation.created / channel.member.* events, and
 * uses it as the recipient source for fan-out (§B9.2). Durable state (no TTL) — rebuilt from the
 * event log on replay. Cold-start gaps are harmless: a missed live push is re-synced by cursor (§G4).
 */
export class MembershipProjection {
  constructor(private readonly redis: Redis) {}

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

  async members(conversationId: string): Promise<string[]> {
    return this.redis.smembers(this.key(conversationId));
  }
}
