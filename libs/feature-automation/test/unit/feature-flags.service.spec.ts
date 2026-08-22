import { FeatureFlagsService } from '../../src/feature-flags/feature-flags.service';
import type { FeatureFlagsRepository } from '../../src/feature-flags/feature-flags.repository';
import type { FeatureFlagsCache } from '../../src/feature-flags/feature-flags.cache';
import type { FeatureFlagsEvents } from '../../src/feature-flags/feature-flags.events';
import type { FeatureFlag, FlagVersionDoc, FlagAuditDoc } from '../../src/feature-flags/flag.types';

function makeSvc() {
  const flags = new Map<string, FeatureFlag>();
  const versions: FlagVersionDoc[] = [];
  const audits: FlagAuditDoc[] = [];
  const key = (t: string | null, k: string): string => `${t ?? 'g'}:${k}`;

  const repo = {
    getByKey: jest.fn(async (t: string | null, k: string) => flags.get(key(t, k)) ?? null),
    getById: jest.fn(async (id: string) => [...flags.values()].find((f) => f._id === id) ?? null),
    insert: jest.fn(async (f: FeatureFlag) => void flags.set(key(f.tenant_id, f.key), f)),
    replace: jest.fn(async (f: FeatureFlag) => void flags.set(key(f.tenant_id, f.key), f)),
    listByScope: jest.fn(async (t: string | null, active = true) =>
      [...flags.values()].filter((f) => f.tenant_id === t && (!active || f.state === 'active')),
    ),
    insertVersion: jest.fn(async (v: FlagVersionDoc) => void versions.push(v)),
    getVersion: jest.fn(
      async (flagId: string, version: number) =>
        versions.find((v) => v.flag_id === flagId && v.version === version) ?? null,
    ),
    listVersions: jest.fn(async () => versions),
    appendAudit: jest.fn(async (a: FlagAuditDoc) => void audits.push(a)),
    listAudit: jest.fn(async () => audits),
    listSegments: jest.fn(async () => []),
    getSegment: jest.fn(async () => null),
    getPlatform: jest.fn(async () => null),
    putPlatform: jest.fn(async () => undefined),
  } as unknown as FeatureFlagsRepository;

  const cache = {
    getFlags: jest.fn(async () => null),
    setFlags: jest.fn(async () => undefined),
    getSegments: jest.fn(async () => null),
    setSegments: jest.fn(async () => undefined),
    getPlatform: jest.fn(async () => null),
    setPlatform: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
  } as unknown as FeatureFlagsCache;

  const emitted: Array<{ tenant: string | null; key: string; action: string; version: number }> =
    [];
  const events = {
    changed: jest.fn(async (tenant: string | null, k: string, action: string, version: number) => {
      emitted.push({ tenant, key: k, action, version });
    }),
  } as unknown as FeatureFlagsEvents;

  return {
    svc: new FeatureFlagsService(repo, cache, events),
    repo,
    cache,
    events,
    emitted,
    store: { flags, versions, audits },
  };
}

describe('FeatureFlagsService', () => {
  it('create: version 1 + snapshot + audit + cache invalidate + event', async () => {
    const { svc, cache, store, emitted } = makeSvc();
    const flag = await svc.create(null, 'admin', { key: 'new-ui', enabled: true });
    expect(flag.version).toBe(1);
    expect(store.versions).toHaveLength(1);
    expect(store.versions[0]!.snapshot.key).toBe('new-ui');
    expect(store.audits[0]).toMatchObject({ action: 'create', actor_id: 'admin' });
    expect(cache.invalidate).toHaveBeenCalledWith(null);
    expect(emitted[0]).toMatchObject({ key: 'new-ui', action: 'create', version: 1 });
  });

  it('create is idempotent-guarded: duplicate key in scope → conflict', async () => {
    const { svc } = makeSvc();
    await svc.create(null, 'a', { key: 'dup' });
    await expect(svc.create(null, 'a', { key: 'dup' })).rejects.toThrow(/already exists/);
  });

  it('disable = kill switch → action disable, version bumps', async () => {
    const { svc, emitted } = makeSvc();
    await svc.create(null, 'a', { key: 'k', enabled: true });
    const off = await svc.setEnabled(null, 'a', 'k', false);
    expect(off.enabled).toBe(false);
    expect(off.version).toBe(2);
    expect(emitted.at(-1)).toMatchObject({ action: 'disable', version: 2 });
  });

  it('rollback restores a prior snapshot as a NEW version (history intact)', async () => {
    const { svc } = makeSvc();
    await svc.create(null, 'a', { key: 'k', enabled: true, defaultValue: false }); // v1
    await svc.setRollout(null, 'a', 'k', { percentage: 50 }); // v2
    const back = await svc.rollback(null, 'a', 'k', 1); // restore v1 as v3
    expect(back.version).toBe(3);
    expect(back.rollout.percentage).toBe(0); // v1 had the default 0%
  });

  it('setRollout rejects an out-of-range percentage', async () => {
    const { svc } = makeSvc();
    await svc.create(null, 'a', { key: 'k' });
    await expect(svc.setRollout(null, 'a', 'k', { percentage: 150 })).rejects.toThrow(/0\.\.100/);
  });

  it('evaluateAll returns a per-flag result map', async () => {
    const { svc } = makeSvc();
    await svc.create(null, 'a', {
      key: 'on',
      enabled: true,
      rollout: { percentage: 100, segmentIds: [], rules: [], userOverrides: {} },
    });
    await svc.create(null, 'a', { key: 'off', enabled: false });
    const { flags } = await svc.evaluateAll(null, { userId: 'u1' });
    expect(flags.on!.on).toBe(true);
    expect(flags.off!.on).toBe(false);
  });

  it('tenant flag overrides a global flag of the same key', async () => {
    const { svc } = makeSvc();
    await svc.create(null, 'a', {
      key: 'x',
      enabled: true,
      rollout: { percentage: 100, segmentIds: [], rules: [], userOverrides: {} },
    }); // global ON
    await svc.create('t1', 'a', { key: 'x', enabled: false }); // tenant OFF
    const { flags } = await svc.evaluateAll('t1', { userId: 'u1' });
    expect(flags.x!.on).toBe(false); // tenant scope wins
  });
});
