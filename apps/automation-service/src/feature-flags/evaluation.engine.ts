import type { EvalContext, EvalResult, FeatureFlag, RolloutRule, Variant } from './flag.types';

/**
 * Pure evaluation engine (docs/FEATURE-FLAGS.md §4). No I/O — fully unit-testable. Callers supply
 * segment-match + dependency resolvers and the maintenance gate, so the same function serves the
 * cached-set evaluation path and tests identically.
 */

/** Deterministic 32-bit FNV-1a hash → 0..9999 bucket, stable across pods/evaluations (no sticky store). */
export function bucket(seed: string, key: string): number {
  const s = `${seed}:${key}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 10000;
}

function ctxValue(ctx: EvalContext, attribute: string): string | undefined {
  switch (attribute) {
    case 'country':
      return ctx.country;
    case 'platform':
      return ctx.platform;
    case 'appVersion':
      return ctx.appVersion;
    case 'role':
      return ctx.role;
    case 'userId':
      return ctx.userId;
    default:
      return ctx.attrs?.[attribute];
  }
}

function parseSemver(v: string): [number, number, number] {
  const p = v.split('.').map((x) => parseInt(x, 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}
function cmpSemver(a: string, b: string): number {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function matchRule(rule: RolloutRule, ctx: EvalContext): boolean {
  const actual = ctxValue(ctx, rule.attribute);
  if (actual === undefined) return false;
  const first = rule.values[0] ?? '';
  switch (rule.op) {
    case 'in':
      return rule.values.includes(actual);
    case 'eq':
      return actual === first;
    case 'neq':
      return actual !== first;
    case 'gte':
      return Number(actual) >= Number(first);
    case 'lte':
      return Number(actual) <= Number(first);
    case 'semverGte':
      return cmpSemver(actual, first) >= 0;
    case 'semverLt':
      return cmpSemver(actual, first) < 0;
    default:
      return false;
  }
}

export function matchAllRules(rules: RolloutRule[], ctx: EvalContext): boolean {
  return rules.every((r) => matchRule(r, ctx));
}

/** Map a bucket (0..9999) into weighted variant ranges. */
function pickVariant(variants: Variant[], b: number): Variant | undefined {
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[0];
  const scaled = (b / 10000) * total;
  let acc = 0;
  for (const v of variants) {
    acc += Math.max(0, v.weight);
    if (scaled < acc) return v;
  }
  return variants[variants.length - 1];
}

export interface EvalDeps {
  /** True if the segment id matches the context (segment rules resolved upstream). */
  segmentMatches: (segmentId: string) => boolean;
  /** True if every dependency flag key evaluates ON for this context. */
  depsOn: (flagKey: string) => boolean;
  /** Maintenance gate: when active, only allowlisted flags evaluate normally. */
  maintenance?: { active: boolean; allowlistFlagKeys: string[] };
}

/** Evaluate one flag for a context. First decisive rule wins (order per §4). */
export function evaluate(flag: FeatureFlag, ctx: EvalContext, deps: EvalDeps): EvalResult {
  const off = (reason: EvalResult['reason']): EvalResult => ({
    key: flag.key,
    on: false,
    value: flag.defaultValue,
    reason,
  });

  if (deps.maintenance?.active && !deps.maintenance.allowlistFlagKeys.includes(flag.key)) {
    return off('maintenance');
  }
  if (!flag.enabled || flag.state !== 'active') return off('killed');
  for (const dep of flag.dependencies) if (!deps.depsOn(dep)) return off('dependency');

  const uid = ctx.userId ?? '';
  if (uid && Object.prototype.hasOwnProperty.call(flag.rollout.userOverrides, uid)) {
    const v = flag.rollout.userOverrides[uid];
    return {
      key: flag.key,
      on: v !== false && v !== undefined && v !== null,
      value: v,
      reason: 'override',
    };
  }

  if (flag.rollout.rules.length > 0 && !matchAllRules(flag.rollout.rules, ctx)) return off('rule');
  if (
    flag.rollout.segmentIds.length > 0 &&
    !flag.rollout.segmentIds.some((s) => deps.segmentMatches(s))
  ) {
    return off('segment');
  }

  const b = bucket(uid || flag.key, flag.key);
  if (b >= flag.rollout.percentage * 100) return off('percentage');

  if (flag.type === 'experiment' && flag.variants.length > 0) {
    const variant = pickVariant(flag.variants, b);
    return {
      key: flag.key,
      on: true,
      value: variant?.value ?? flag.value ?? true,
      variant: variant?.key,
      reason: 'rollout',
    };
  }
  return {
    key: flag.key,
    on: true,
    value: flag.type === 'config' ? flag.value : true,
    reason: 'rollout',
  };
}
