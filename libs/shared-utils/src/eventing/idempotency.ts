import type { Redis } from 'ioredis';

/**
 * Valkey-backed idempotency / dedupe store (§A11, §G6-4, §G7).
 *
 * Consumers call {@link markIfNew} with the envelope `event_id`; the atomic `SET NX`
 * returns `true` exactly once per id, so re-delivered events are processed at-most-once
 * for their side effects. TTL defaults to the event retention window (7d, §A11).
 */
export class IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly namespace = 'idem',
  ) {}

  private keyFor(id: string): string {
    return `${this.namespace}:${id}`;
  }

  /** Returns `true` if this id was newly recorded (caller should process), `false` if duplicate. */
  async markIfNew(eventId: string, ttlSeconds = 7 * 24 * 3600): Promise<boolean> {
    const result = await this.redis.set(this.keyFor(eventId), '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async wasProcessed(eventId: string): Promise<boolean> {
    return (await this.redis.exists(this.keyFor(eventId))) === 1;
  }
}
