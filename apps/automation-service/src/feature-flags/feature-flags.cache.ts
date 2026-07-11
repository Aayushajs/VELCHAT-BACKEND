import type { Redis } from 'ioredis';
import type { FeatureFlag, PlatformConfigDoc, Segment } from './flag.types';

/**
 * Per-scope Valkey cache of flag definitions (docs/FEATURE-FLAGS.md §5). Scopes are cached
 * SEPARATELY (`global` vs each tenant) and merged in-process per request, so a global change
 * invalidates only `global` while every tenant still reads fresh global on its next eval.
 */
const TTL_SECONDS = 300;
const scopeOf = (tenantId: string | null): string => tenantId ?? 'global';

export class FeatureFlagsCache {
  constructor(private readonly redis: Redis) {}

  async getFlags(tenantId: string | null): Promise<FeatureFlag[] | null> {
    const v = await this.redis.get(`ff:flags:${scopeOf(tenantId)}`);
    return v ? (JSON.parse(v) as FeatureFlag[]) : null;
  }
  async setFlags(tenantId: string | null, flags: FeatureFlag[]): Promise<void> {
    await this.redis.set(`ff:flags:${scopeOf(tenantId)}`, JSON.stringify(flags), 'EX', TTL_SECONDS);
  }

  async getSegments(tenantId: string | null): Promise<Segment[] | null> {
    const v = await this.redis.get(`ff:segments:${scopeOf(tenantId)}`);
    return v ? (JSON.parse(v) as Segment[]) : null;
  }
  async setSegments(tenantId: string | null, segments: Segment[]): Promise<void> {
    await this.redis.set(
      `ff:segments:${scopeOf(tenantId)}`,
      JSON.stringify(segments),
      'EX',
      TTL_SECONDS,
    );
  }

  async getPlatform(tenantId: string | null): Promise<PlatformConfigDoc | null> {
    const v = await this.redis.get(`ff:platform:${scopeOf(tenantId)}`);
    return v ? (JSON.parse(v) as PlatformConfigDoc) : null;
  }
  async setPlatform(tenantId: string | null, cfg: PlatformConfigDoc): Promise<void> {
    await this.redis.set(
      `ff:platform:${scopeOf(tenantId)}`,
      JSON.stringify(cfg),
      'EX',
      TTL_SECONDS,
    );
  }

  /** Drop every cached key for a scope after a mutation (event-driven invalidation). */
  async invalidate(tenantId: string | null): Promise<void> {
    const s = scopeOf(tenantId);
    await this.redis.del(`ff:flags:${s}`, `ff:segments:${s}`, `ff:platform:${s}`);
  }
}
