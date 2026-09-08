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

  /**
   * Is the user ACTIVELY USING the app right now — the only state in which a push would be noise.
   *
   * Reads presence (`online:{u}`), not the socket registry (`conn:{u}`). Holding a socket is not
   * the same as looking at the screen, and treating it as such is why a backgrounded app got no
   * notification at all: the client keeps its WebSocket for a grace period after backgrounding,
   * the server saw a live connection, `decideNotify` said "they can see it", and no push was ever
   * enqueued. Worse, that grace period is itself gated on push being available — so a device that
   * had not registered for push kept its socket indefinitely and could never receive one. A
   * deadlock: no push, therefore no push.
   *
   * Presence has none of that. `online:{u}` is refreshed by a 20s client heartbeat against a 30s
   * TTL, and Android throttles that timer the moment the app leaves the foreground — so the key
   * lapses on its own, and the client also announces `presence/offline` immediately on
   * backgrounding. Foreground means online; anything else does not.
   */
  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(`online:${userId}`)) > 0;
  }
}
