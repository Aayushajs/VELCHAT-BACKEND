import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Translation cache (§B20): key `xlate:{sha256(text)}:{src}:{tgt}` → translated text. Same
 * text+lang pair is served from cache so repeat views are instant and cost-free. TTL bounds growth.
 */
export class TranslationCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 7 * 24 * 3600,
  ) {}

  static key(text: string, src: string, tgt: string): string {
    const h = createHash('sha256').update(text).digest('hex').slice(0, 32);
    return `xlate:${h}:${src}:${tgt}`;
  }

  async get(text: string, src: string, tgt: string): Promise<string | null> {
    return this.redis.get(TranslationCache.key(text, src, tgt));
  }

  async set(text: string, src: string, tgt: string, value: string): Promise<void> {
    await this.redis.set(TranslationCache.key(text, src, tgt), value, 'EX', this.ttlSec);
  }
}
