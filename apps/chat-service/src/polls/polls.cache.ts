import type { Redis } from 'ioredis';

export interface TallyData {
  counts: Record<string, number>;
  voters: Record<string, string[]>;
}

/** Valkey cache of poll tallies (§B16) so repeat reads are instant; overwritten on each vote. */
export class PollsCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 60,
  ) {}

  private key(messageId: string): string {
    return `poll:tally:${messageId}`;
  }

  async get(messageId: string): Promise<TallyData | null> {
    const raw = await this.redis.get(this.key(messageId));
    return raw ? (JSON.parse(raw) as TallyData) : null;
  }

  async set(messageId: string, tally: TallyData): Promise<void> {
    await this.redis.set(this.key(messageId), JSON.stringify(tally), 'EX', this.ttlSec);
  }
}
