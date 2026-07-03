import type { Redis } from 'ioredis';

/**
 * Event-sourced membership projection + presence lookup (§A10.5). notification-service resolves
 * recipients from its own `members:{conv}` set (fed by conversation.created / channel.member.*) and
 * checks liveness via the realtime gateway's `conn:{user}` registry — both in the shared Valkey.
 */
export class MembersProjection {
  constructor(private readonly redis: Redis) {}

  private key(conversationId: string): string {
    return `members:${conversationId}`;
  }

  async seed(conversationId: string, memberIds: string[]): Promise<void> {
    if (memberIds.length > 0) await this.redis.sadd(this.key(conversationId), ...memberIds);
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

  /** Online iff the realtime gateway holds ≥1 live socket for this user. */
  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(`conn:${userId}`)) > 0;
  }
}
