import { bucket, evaluate, matchRule } from '../../src/feature-flags/evaluation.engine';
import type { EvalContext, FeatureFlag } from '../../src/feature-flags/flag.types';

function flag(over: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    _id: 'f1',
    key: 'k',
    tenant_id: null,
    type: 'boolean',
    tags: [],
    enabled: true,
    defaultValue: false,
    variants: [],
    rollout: { percentage: 100, segmentIds: [], rules: [], userOverrides: {} },
    dependencies: [],
    state: 'active',
    version: 1,
    created_at: 'iso',
    updated_at: 'iso',
    updated_by: null,
    ...over,
  };
}
const noDeps = { segmentMatches: () => false, depsOn: () => true };

describe('bucket (deterministic FNV-1a §4)', () => {
  it('is stable for the same user+key and in range', () => {
    const a = bucket('user-1', 'flag-a');
    expect(a).toBe(bucket('user-1', 'flag-a'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(10000);
  });
  it('differs across users/keys (spread)', () => {
    expect(bucket('user-1', 'flag-a')).not.toBe(bucket('user-2', 'flag-a'));
  });
});

describe('matchRule (§4 ops)', () => {
  const ctx: EvalContext = { country: 'IN', platform: 'ios', appVersion: '2.5.1', role: 'admin' };
  it('in / eq / neq', () => {
    expect(matchRule({ attribute: 'country', op: 'in', values: ['IN', 'US'] }, ctx)).toBe(true);
    expect(matchRule({ attribute: 'platform', op: 'eq', values: ['ios'] }, ctx)).toBe(true);
    expect(matchRule({ attribute: 'platform', op: 'neq', values: ['android'] }, ctx)).toBe(true);
  });
  it('semverGte / semverLt', () => {
    expect(matchRule({ attribute: 'appVersion', op: 'semverGte', values: ['2.4.0'] }, ctx)).toBe(
      true,
    );
    expect(matchRule({ attribute: 'appVersion', op: 'semverGte', values: ['2.6.0'] }, ctx)).toBe(
      false,
    );
    expect(matchRule({ attribute: 'appVersion', op: 'semverLt', values: ['3.0.0'] }, ctx)).toBe(
      true,
    );
  });
  it('missing attribute → no match', () => {
    expect(matchRule({ attribute: 'country', op: 'in', values: ['IN'] }, {})).toBe(false);
  });
});

describe('evaluate (§4 precedence)', () => {
  const ctx: EvalContext = {
    userId: 'u1',
    country: 'IN',
    platform: 'ios',
    appVersion: '2.5.0',
    role: 'member',
  };

  it('kill switch: disabled → off', () => {
    expect(evaluate(flag({ enabled: false }), ctx, noDeps).reason).toBe('killed');
  });
  it('archived → off (killed)', () => {
    expect(evaluate(flag({ state: 'archived' }), ctx, noDeps).on).toBe(false);
  });
  it('dependency off → off', () => {
    const r = evaluate(flag({ dependencies: ['parent'] }), ctx, { ...noDeps, depsOn: () => false });
    expect(r.reason).toBe('dependency');
  });
  it('user override wins over everything else', () => {
    const f = flag({
      rollout: { percentage: 0, segmentIds: [], rules: [], userOverrides: { u1: true } },
    });
    const r = evaluate(f, ctx, noDeps);
    expect(r).toMatchObject({ on: true, reason: 'override' });
  });
  it('rules AND: non-match → off', () => {
    const f = flag({
      rollout: {
        percentage: 100,
        segmentIds: [],
        rules: [{ attribute: 'country', op: 'in', values: ['US'] }],
        userOverrides: {},
      },
    });
    expect(evaluate(f, ctx, noDeps).reason).toBe('rule');
  });
  it('segment OR: no segment matches → off', () => {
    const f = flag({
      rollout: { percentage: 100, segmentIds: ['s1'], rules: [], userOverrides: {} },
    });
    expect(evaluate(f, ctx, { ...noDeps, segmentMatches: () => false }).reason).toBe('segment');
    expect(evaluate(f, ctx, { ...noDeps, segmentMatches: () => true }).on).toBe(true);
  });
  it('percentage 0 → off, 100 → on', () => {
    expect(
      evaluate(
        flag({ rollout: { percentage: 0, segmentIds: [], rules: [], userOverrides: {} } }),
        ctx,
        noDeps,
      ).reason,
    ).toBe('percentage');
    expect(
      evaluate(
        flag({ rollout: { percentage: 100, segmentIds: [], rules: [], userOverrides: {} } }),
        ctx,
        noDeps,
      ).on,
    ).toBe(true);
  });
  it('config flag returns its value when on', () => {
    const f = flag({ type: 'config', value: { color: 'blue' } });
    expect(evaluate(f, ctx, noDeps).value).toEqual({ color: 'blue' });
  });
  it('experiment picks a weighted variant', () => {
    const f = flag({
      type: 'experiment',
      variants: [
        { key: 'control', value: 'c', weight: 0 },
        { key: 'treatment', value: 't', weight: 100 },
      ],
    });
    const r = evaluate(f, ctx, noDeps);
    expect(r.on).toBe(true);
    expect(r.variant).toBe('treatment'); // control weight 0 → always treatment
  });
  it('maintenance mode: non-allowlisted → off', () => {
    const r = evaluate(flag(), ctx, {
      ...noDeps,
      maintenance: { active: true, allowlistFlagKeys: [] },
    });
    expect(r.reason).toBe('maintenance');
    const allowed = evaluate(flag(), ctx, {
      ...noDeps,
      maintenance: { active: true, allowlistFlagKeys: ['k'] },
    });
    expect(allowed.on).toBe(true);
  });
});
