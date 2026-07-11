import { uuidv7, NotFoundError, ValidationError, ConflictError } from '@velchat/common';
import { FeatureFlagsRepository } from './feature-flags.repository';
import { FeatureFlagsCache } from './feature-flags.cache';
import { FeatureFlagsEvents } from './feature-flags.events';
import { evaluate, matchAllRules } from './evaluation.engine';
import type {
  AnnouncementConfig,
  EvalContext,
  EvalResult,
  FeatureFlag,
  FlagAction,
  MaintenanceConfig,
  PlatformConfigDoc,
  Rollout,
  RolloutRule,
  ScheduleAction,
  Segment,
  Variant,
} from './flag.types';

const nowIso = (): string => new Date().toISOString();
const DEFAULT_ROLLOUT: Rollout = { percentage: 0, segmentIds: [], rules: [], userOverrides: {} };

export interface CreateFlagInput {
  key: string;
  type?: FeatureFlag['type'];
  description?: string;
  tags?: string[];
  enabled?: boolean;
  value?: unknown;
  defaultValue?: unknown;
  variants?: Variant[];
  rollout?: Partial<Rollout>;
  dependencies?: string[];
}

/** Evaluation bundle for a tenant (global scope merged under the tenant scope). */
interface Bundle {
  flags: FeatureFlag[];
  segments: Segment[];
  platform: PlatformConfigDoc | null;
}

/**
 * Feature-flag orchestration (docs/FEATURE-FLAGS.md). Every mutation: bump version → write an
 * immutable snapshot → append audit → invalidate cache → emit `featureflag.changed`. Evaluation
 * runs the pure engine over a cached, merged (global + tenant) definition set.
 */
export class FeatureFlagsService {
  constructor(
    private readonly repo: FeatureFlagsRepository,
    private readonly cache: FeatureFlagsCache,
    private readonly events: FeatureFlagsEvents,
  ) {}

  // ── admin: flags ──
  async create(
    tenantId: string | null,
    actorId: string | null,
    input: CreateFlagInput,
  ): Promise<FeatureFlag> {
    if (!input.key) throw new ValidationError('key is required');
    if (await this.repo.getByKey(tenantId, input.key)) {
      throw new ConflictError(`flag "${input.key}" already exists in this scope`);
    }
    const flag: FeatureFlag = {
      _id: uuidv7(),
      key: input.key,
      tenant_id: tenantId,
      type: input.type ?? 'boolean',
      description: input.description,
      tags: input.tags ?? [],
      enabled: input.enabled ?? false,
      value: input.value,
      defaultValue: input.defaultValue ?? false,
      variants: input.variants ?? [],
      rollout: { ...DEFAULT_ROLLOUT, ...(input.rollout ?? {}) },
      dependencies: input.dependencies ?? [],
      state: 'active',
      version: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
      updated_by: actorId,
    };
    return this.commit(flag, null, 'create', actorId);
  }

  async get(tenantId: string | null, key: string): Promise<FeatureFlag> {
    return this.require(tenantId, key);
  }

  list(tenantId: string | null, includeArchived = false): Promise<FeatureFlag[]> {
    return this.repo.listByScope(tenantId, !includeArchived);
  }

  async update(
    tenantId: string | null,
    actorId: string | null,
    key: string,
    patch: Partial<
      Pick<
        FeatureFlag,
        'description' | 'tags' | 'value' | 'defaultValue' | 'variants' | 'dependencies' | 'type'
      >
    >,
  ): Promise<FeatureFlag> {
    const cur = await this.require(tenantId, key);
    const next: FeatureFlag = { ...cur, ...patch };
    return this.commit(next, cur, 'update', actorId);
  }

  async setEnabled(
    tenantId: string | null,
    actorId: string | null,
    key: string,
    enabled: boolean,
  ): Promise<FeatureFlag> {
    const cur = await this.require(tenantId, key);
    return this.commit({ ...cur, enabled }, cur, enabled ? 'enable' : 'disable', actorId);
  }

  async setRollout(
    tenantId: string | null,
    actorId: string | null,
    key: string,
    rollout: Partial<Rollout>,
  ): Promise<FeatureFlag> {
    const cur = await this.require(tenantId, key);
    const pct = rollout.percentage;
    if (pct !== undefined && (pct < 0 || pct > 100)) {
      throw new ValidationError('percentage must be 0..100');
    }
    return this.commit(
      { ...cur, rollout: { ...cur.rollout, ...rollout } },
      cur,
      'rollout',
      actorId,
    );
  }

  async archive(
    tenantId: string | null,
    actorId: string | null,
    key: string,
  ): Promise<FeatureFlag> {
    const cur = await this.require(tenantId, key);
    return this.commit({ ...cur, state: 'archived', enabled: false }, cur, 'archive', actorId);
  }

  /** Emergency rollback — restores a prior snapshot forward as a NEW version (history intact). */
  async rollback(
    tenantId: string | null,
    actorId: string | null,
    key: string,
    toVersion: number,
  ): Promise<FeatureFlag> {
    const cur = await this.require(tenantId, key);
    const snap = await this.repo.getVersion(cur._id, toVersion);
    if (!snap) throw new NotFoundError(`version ${toVersion} not found`);
    const restored: FeatureFlag = { ...snap.snapshot, _id: cur._id, version: cur.version };
    return this.commit(restored, cur, 'rollback', actorId, `rollback to v${toVersion}`);
  }

  async versions(tenantId: string | null, key: string): Promise<unknown[]> {
    const cur = await this.require(tenantId, key);
    return this.repo.listVersions(cur._id);
  }
  async audit(tenantId: string | null, key: string): Promise<unknown[]> {
    const cur = await this.require(tenantId, key);
    return this.repo.listAudit({ flagId: cur._id });
  }

  // ── scheduling ──
  async schedule(
    tenantId: string | null,
    actorId: string | null,
    key: string,
    action: ScheduleAction,
    runAt: string,
  ): Promise<{ scheduleId: string }> {
    const cur = await this.require(tenantId, key);
    const scheduleId = uuidv7();
    await this.repo.insertSchedule({
      _id: scheduleId,
      flag_id: cur._id,
      tenant_id: tenantId,
      action,
      run_at: runAt,
      status: 'pending',
      created_by: actorId,
      created_at: nowIso(),
    });
    await this.repo.appendAudit({
      _id: uuidv7(),
      tenant_id: tenantId,
      flag_id: cur._id,
      actor_id: actorId,
      action: 'schedule',
      before: null,
      after: { action, runAt },
      at: nowIso(),
    });
    return { scheduleId };
  }
  async cancelSchedule(scheduleId: string): Promise<{ cancelled: true }> {
    await this.repo.cancelSchedule(scheduleId);
    return { cancelled: true };
  }
  listSchedules(tenantId: string | null, key: string): Promise<unknown[]> {
    return this.require(tenantId, key).then((f) => this.repo.listSchedules(f._id));
  }

  // ── segments ──
  async createSegment(
    tenantId: string | null,
    key: string,
    name: string,
    rules: RolloutRule[],
  ): Promise<Segment> {
    if (!key) throw new ValidationError('segment key is required');
    if (await this.repo.getSegment(tenantId, key)) throw new ConflictError('segment exists');
    const seg: Segment = {
      _id: uuidv7(),
      key,
      tenant_id: tenantId,
      name,
      rules,
      created_at: nowIso(),
    };
    await this.repo.insertSegment(seg);
    await this.cache.invalidate(tenantId);
    return seg;
  }
  listSegments(tenantId: string | null): Promise<Segment[]> {
    return this.repo.listSegments(tenantId);
  }
  async updateSegment(
    tenantId: string | null,
    key: string,
    patch: { name?: string; rules?: RolloutRule[] },
  ): Promise<Segment> {
    const cur = await this.repo.getSegment(tenantId, key);
    if (!cur) throw new NotFoundError('segment not found');
    const next: Segment = { ...cur, ...patch };
    await this.repo.replaceSegment(next);
    await this.cache.invalidate(tenantId);
    return next;
  }
  async deleteSegment(tenantId: string | null, key: string): Promise<{ deleted: true }> {
    const cur = await this.repo.getSegment(tenantId, key);
    if (!cur) throw new NotFoundError('segment not found');
    await this.repo.deleteSegment(cur._id);
    await this.cache.invalidate(tenantId);
    return { deleted: true };
  }

  // ── platform config: maintenance + announcement ──
  async getPlatform(tenantId: string | null): Promise<PlatformConfigDoc> {
    return this.loadPlatform(tenantId);
  }
  async setMaintenance(
    tenantId: string | null,
    actorId: string | null,
    maintenance: MaintenanceConfig,
  ): Promise<PlatformConfigDoc> {
    const cur = await this.loadPlatform(tenantId);
    const next: PlatformConfigDoc = {
      ...cur,
      maintenance,
      updated_by: actorId,
      updated_at: nowIso(),
    };
    await this.repo.putPlatform(next);
    await this.cache.invalidate(tenantId);
    await this.events.changed(tenantId, '*', 'maintenance', 0);
    return next;
  }
  async setAnnouncement(
    tenantId: string | null,
    actorId: string | null,
    announcement: AnnouncementConfig,
  ): Promise<PlatformConfigDoc> {
    const cur = await this.loadPlatform(tenantId);
    const next: PlatformConfigDoc = {
      ...cur,
      announcement,
      updated_by: actorId,
      updated_at: nowIso(),
    };
    await this.repo.putPlatform(next);
    await this.cache.invalidate(tenantId);
    await this.events.changed(tenantId, '*', 'announcement', 0);
    return next;
  }

  // ── evaluation (client hot path) ──
  async evaluateAll(
    tenantId: string | null,
    ctx: EvalContext,
  ): Promise<{
    flags: Record<string, EvalResult>;
    announcement: AnnouncementConfig | null;
    maintenance: boolean;
  }> {
    const bundle = await this.loadBundle(tenantId);
    return this.evaluateSet(bundle, ctx);
  }

  async evaluateOne(tenantId: string | null, key: string, ctx: EvalContext): Promise<EvalResult> {
    const { flags } = await this.evaluateAll(tenantId, ctx);
    const r = flags[key];
    if (!r) throw new NotFoundError(`flag "${key}" not found`);
    return r;
  }

  // ── internals ──
  private async require(tenantId: string | null, key: string): Promise<FeatureFlag> {
    const f = await this.repo.getByKey(tenantId, key);
    if (!f) throw new NotFoundError(`flag "${key}" not found`);
    return f;
  }

  /** Persist a mutation atomically at the app level: version++, snapshot, audit, invalidate, emit. */
  private async commit(
    next: FeatureFlag,
    before: FeatureFlag | null,
    action: FlagAction,
    actorId: string | null,
    reason?: string,
  ): Promise<FeatureFlag> {
    next.version = (before?.version ?? 0) + 1;
    next.updated_at = nowIso();
    next.updated_by = actorId;
    if (before) await this.repo.replace(next);
    else await this.repo.insert(next);
    await this.repo.insertVersion({
      _id: uuidv7(),
      flag_id: next._id,
      key: next.key,
      tenant_id: next.tenant_id,
      version: next.version,
      snapshot: next,
      changed_by: actorId,
      reason,
      created_at: nowIso(),
    });
    await this.repo.appendAudit({
      _id: uuidv7(),
      tenant_id: next.tenant_id,
      flag_id: next._id,
      actor_id: actorId,
      action,
      before,
      after: next,
      at: nowIso(),
    });
    await this.cache.invalidate(next.tenant_id);
    await this.events.changed(next.tenant_id, next.key, action, next.version);
    return next;
  }

  /** Merge global + tenant scopes (tenant wins on key collision), cache each scope separately. */
  private async loadBundle(tenantId: string | null): Promise<Bundle> {
    const [globalFlags, tenantFlags] = await Promise.all([
      this.loadFlags(null),
      tenantId ? this.loadFlags(tenantId) : Promise.resolve([]),
    ]);
    const byKey = new Map<string, FeatureFlag>();
    for (const f of globalFlags) byKey.set(f.key, f);
    for (const f of tenantFlags) byKey.set(f.key, f); // tenant overrides global
    const [globalSegs, tenantSegs, platform] = await Promise.all([
      this.loadSegments(null),
      tenantId ? this.loadSegments(tenantId) : Promise.resolve([]),
      this.loadPlatform(tenantId),
    ]);
    return { flags: [...byKey.values()], segments: [...globalSegs, ...tenantSegs], platform };
  }

  private async loadFlags(tenantId: string | null): Promise<FeatureFlag[]> {
    const cached = await this.cache.getFlags(tenantId);
    if (cached) return cached;
    const flags = await this.repo.listByScope(tenantId, true);
    await this.cache.setFlags(tenantId, flags);
    return flags;
  }
  private async loadSegments(tenantId: string | null): Promise<Segment[]> {
    const cached = await this.cache.getSegments(tenantId);
    if (cached) return cached;
    const segs = await this.repo.listSegments(tenantId);
    await this.cache.setSegments(tenantId, segs);
    return segs;
  }
  private async loadPlatform(tenantId: string | null): Promise<PlatformConfigDoc> {
    const scope = tenantId ?? 'global';
    const cached = await this.cache.getPlatform(tenantId);
    if (cached) return cached;
    const doc =
      (await this.repo.getPlatform(scope)) ??
      ({
        _id: scope,
        maintenance: { enabled: false, allowlistFlagKeys: [], allowRoles: [] },
        announcement: null,
        updated_by: null,
        updated_at: nowIso(),
      } satisfies PlatformConfigDoc);
    await this.cache.setPlatform(tenantId, doc);
    return doc;
  }

  /** Run the pure engine over the set, resolving segments + dependencies with a cycle guard. */
  private evaluateSet(
    bundle: Bundle,
    ctx: EvalContext,
  ): {
    flags: Record<string, EvalResult>;
    announcement: AnnouncementConfig | null;
    maintenance: boolean;
  } {
    const byKey = new Map(bundle.flags.map((f) => [f.key, f]));
    const segById = new Map(bundle.segments.map((s) => [s._id, s]));
    const maint = bundle.platform?.maintenance;
    const maintenanceActive =
      !!maint?.enabled && !(ctx.role && maint.allowRoles.includes(ctx.role));
    const maintenance = {
      active: maintenanceActive,
      allowlistFlagKeys: maint?.allowlistFlagKeys ?? [],
    };

    const segmentMatches = (segmentId: string): boolean => {
      const seg = segById.get(segmentId);
      return seg ? matchAllRules(seg.rules, ctx) : false;
    };
    const memo = new Map<string, EvalResult>();
    const evalKey = (key: string, stack: Set<string>): EvalResult => {
      const cached = memo.get(key);
      if (cached) return cached;
      const flag = byKey.get(key);
      if (!flag) {
        const r: EvalResult = { key, on: false, value: false, reason: 'dependency' };
        return r;
      }
      if (stack.has(key)) {
        // cycle → treat as off to avoid infinite recursion
        return { key, on: false, value: flag.defaultValue, reason: 'dependency' };
      }
      stack.add(key);
      const depsOn = (depKey: string): boolean => evalKey(depKey, stack).on;
      const result = evaluate(flag, ctx, { segmentMatches, depsOn, maintenance });
      stack.delete(key);
      memo.set(key, result);
      return result;
    };

    const flags: Record<string, EvalResult> = {};
    for (const f of bundle.flags) flags[f.key] = evalKey(f.key, new Set());
    return {
      flags,
      announcement: bundle.platform?.announcement ?? null,
      maintenance: maintenanceActive,
    };
  }
}
