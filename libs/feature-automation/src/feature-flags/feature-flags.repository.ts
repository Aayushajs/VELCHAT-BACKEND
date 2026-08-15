import type { MongoClient } from '@velchat/database';
import type {
  FeatureFlag,
  FlagAuditDoc,
  FlagScheduleDoc,
  FlagVersionDoc,
  PlatformConfigDoc,
  Segment,
} from './flag.types';

/**
 * Feature-flag data access (docs/FEATURE-FLAGS.md §3, MongoDB only). Owned by automation-service.
 * App-generated string ids; update docs cast `as never` to satisfy the driver's schema-bound typings
 * on an untyped collection (matches the chat repo convention).
 */
export class FeatureFlagsRepository {
  constructor(private readonly mongo: MongoClient) {}

  private db() {
    return this.mongo.db;
  }

  /** Idempotent index creation on boot (no separate migration — Mongo-only, §12). */
  async ensureIndexes(): Promise<void> {
    await this.db()
      .collection('feature_flags')
      .createIndex({ key: 1, tenant_id: 1 }, { unique: true });
    await this.db().collection('feature_flags').createIndex({ tenant_id: 1, state: 1 });
    await this.db().collection('feature_flags').createIndex({ tags: 1 });
    await this.db()
      .collection('flag_segments')
      .createIndex({ key: 1, tenant_id: 1 }, { unique: true });
    await this.db().collection('flag_config_versions').createIndex({ flag_id: 1, version: -1 });
    await this.db().collection('flag_audit').createIndex({ tenant_id: 1, at: -1 });
    await this.db().collection('flag_audit').createIndex({ flag_id: 1, at: -1 });
    await this.db().collection('flag_schedules').createIndex({ status: 1, run_at: 1 });
  }

  // ── flags ──
  async listByScope(tenantId: string | null, onlyActive = true): Promise<FeatureFlag[]> {
    const q: Record<string, unknown> = { tenant_id: tenantId };
    if (onlyActive) q.state = 'active';
    const rows = await this.db()
      .collection('feature_flags')
      .find(q as never)
      .toArray();
    return rows as unknown as FeatureFlag[];
  }

  async getByKey(tenantId: string | null, key: string): Promise<FeatureFlag | null> {
    const doc = await this.db()
      .collection('feature_flags')
      .findOne({ key, tenant_id: tenantId } as never);
    return (doc as FeatureFlag | null) ?? null;
  }

  async getById(id: string): Promise<FeatureFlag | null> {
    const doc = await this.db()
      .collection('feature_flags')
      .findOne({ _id: id as never });
    return (doc as FeatureFlag | null) ?? null;
  }

  async insert(flag: FeatureFlag): Promise<void> {
    await this.db()
      .collection('feature_flags')
      .insertOne(flag as never);
  }

  /** Full-document replace (whole flag doc is rewritten on every version bump). */
  async replace(flag: FeatureFlag): Promise<void> {
    await this.db()
      .collection('feature_flags')
      .replaceOne({ _id: flag._id as never }, flag as never);
  }

  // ── versions ──
  async insertVersion(v: FlagVersionDoc): Promise<void> {
    await this.db()
      .collection('flag_config_versions')
      .insertOne(v as never);
  }
  async listVersions(flagId: string, limit = 50): Promise<FlagVersionDoc[]> {
    const rows = await this.db()
      .collection('flag_config_versions')
      .find({ flag_id: flagId } as never)
      .sort({ version: -1 })
      .limit(limit)
      .toArray();
    return rows as unknown as FlagVersionDoc[];
  }
  async getVersion(flagId: string, version: number): Promise<FlagVersionDoc | null> {
    const doc = await this.db()
      .collection('flag_config_versions')
      .findOne({ flag_id: flagId, version } as never);
    return (doc as FlagVersionDoc | null) ?? null;
  }
  /** Keep the newest `keep` versions, drop older ones (cleanup job). */
  async pruneVersions(flagId: string, keep: number): Promise<void> {
    const kept = await this.db()
      .collection('flag_config_versions')
      .find({ flag_id: flagId } as never)
      .sort({ version: -1 })
      .limit(keep)
      .toArray();
    const minKept = (kept[kept.length - 1] as FlagVersionDoc | undefined)?.version;
    if (minKept === undefined) return;
    await this.db()
      .collection('flag_config_versions')
      .deleteMany({ flag_id: flagId, version: { $lt: minKept } } as never);
  }

  // ── audit ──
  async appendAudit(a: FlagAuditDoc): Promise<void> {
    await this.db()
      .collection('flag_audit')
      .insertOne(a as never);
  }
  async listAudit(
    filter: { flagId?: string; tenantId?: string | null },
    limit = 100,
  ): Promise<FlagAuditDoc[]> {
    const q = filter.flagId ? { flag_id: filter.flagId } : { tenant_id: filter.tenantId ?? null };
    const rows = await this.db()
      .collection('flag_audit')
      .find(q as never)
      .sort({ at: -1 })
      .limit(limit)
      .toArray();
    return rows as unknown as FlagAuditDoc[];
  }

  // ── segments ──
  async listSegments(tenantId: string | null): Promise<Segment[]> {
    const rows = await this.db()
      .collection('flag_segments')
      .find({ tenant_id: tenantId } as never)
      .toArray();
    return rows as unknown as Segment[];
  }
  async getSegment(tenantId: string | null, key: string): Promise<Segment | null> {
    const doc = await this.db()
      .collection('flag_segments')
      .findOne({ key, tenant_id: tenantId } as never);
    return (doc as Segment | null) ?? null;
  }
  async insertSegment(s: Segment): Promise<void> {
    await this.db()
      .collection('flag_segments')
      .insertOne(s as never);
  }
  async replaceSegment(s: Segment): Promise<void> {
    await this.db()
      .collection('flag_segments')
      .replaceOne({ _id: s._id as never }, s as never);
  }
  async deleteSegment(id: string): Promise<void> {
    await this.db()
      .collection('flag_segments')
      .deleteOne({ _id: id as never });
  }

  // ── schedules ──
  async insertSchedule(s: FlagScheduleDoc): Promise<void> {
    await this.db()
      .collection('flag_schedules')
      .insertOne(s as never);
  }
  async listSchedules(flagId: string): Promise<FlagScheduleDoc[]> {
    const rows = await this.db()
      .collection('flag_schedules')
      .find({ flag_id: flagId } as never)
      .sort({ run_at: 1 })
      .toArray();
    return rows as unknown as FlagScheduleDoc[];
  }
  async cancelSchedule(id: string): Promise<void> {
    await this.db()
      .collection('flag_schedules')
      .updateOne({ _id: id as never }, { $set: { status: 'cancelled' } } as never);
  }
  async dueSchedules(nowIso: string, limit = 50): Promise<FlagScheduleDoc[]> {
    const rows = await this.db()
      .collection('flag_schedules')
      .find({ status: 'pending', run_at: { $lte: nowIso } } as never)
      .limit(limit)
      .toArray();
    return rows as unknown as FlagScheduleDoc[];
  }
  async markScheduleDone(id: string): Promise<void> {
    await this.db()
      .collection('flag_schedules')
      .updateOne({ _id: id as never }, { $set: { status: 'done' } } as never);
  }

  // ── platform config (maintenance + announcement) ──
  async getPlatform(scopeId: string): Promise<PlatformConfigDoc | null> {
    const doc = await this.db()
      .collection('platform_config')
      .findOne({ _id: scopeId as never });
    return (doc as PlatformConfigDoc | null) ?? null;
  }
  async putPlatform(cfg: PlatformConfigDoc): Promise<void> {
    await this.db()
      .collection('platform_config')
      .replaceOne({ _id: cfg._id as never }, cfg as never, { upsert: true });
  }
}
