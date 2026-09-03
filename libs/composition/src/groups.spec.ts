import { loadConfig } from '@velchat/config';
import { createLogger } from '@velchat/common';
import { createInfraContext } from '@velchat/infra-context';
import {
  identityGroup,
  messagingGroup,
  realtimeGroup,
  contentGroup,
  platformGroup,
  allGroups,
} from './groups';
import { mergeMounted, mergeNeeds, type FeatureGroup } from './mounted';

/** Everything configured, so an absent store proves a group declared its needs narrowly. */
const config = loadConfig({
  SERVICE_NAME: 'composition-test',
  NODE_ENV: 'test',
  AUTH_DEV_INSECURE: 'true',
  POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
  MONGO_URL: 'mongodb://localhost:27017/db',
  VALKEY_URL: 'redis://localhost:6379',
  CLOUDINARY_URL: 'cloudinary://k:s@cloud',
} as NodeJS.ProcessEnv);
const logger = createLogger(config);

const groups = () => allGroups(config, logger);
const mountOf = (g: FeatureGroup) =>
  g.mount(
    createInfraContext({ config, logger, metrics: { registry: null } as never }, { need: g.need }),
  );

describe('feature groups', () => {
  it('names every group in the axis-6 topology', () => {
    expect(groups().map((g) => g.name)).toEqual([
      'identity',
      'messaging',
      'realtime',
      'content',
      'platform',
    ]);
  });

  it('keeps realtime on Valkey only — the socket tier must not depend on a database', () => {
    // The whole reason status/stories was moved to the content group. If Postgres appears here,
    // every status or media deploy would restart the process holding every live WebSocket.
    expect([...realtimeGroup().need].sort()).toEqual(['eventBus', 'valkey']);
  });

  it('gives messaging the Mongo it owns, since search indexes chat’s own collection', () => {
    expect(messagingGroup(config, logger).need).toContain('mongo');
    expect(messagingGroup(config, logger).need).toContain('search');
  });

  it('gives content object storage and no Mongo', () => {
    const need = contentGroup(config, logger).need;
    expect(need).toContain('storage');
    expect(need).not.toContain('mongo');
  });

  it('gives platform the three stores its features span', () => {
    // calls + automation + AI: Postgres for calls/jobs, Mongo + Valkey for feature flags. Three
    // scaling axes sharing one process only because all three are near-idle in the MVP — the
    // documented trigger is to extract `ai` first if server-side inference ever takes real load.
    const need = platformGroup(config, logger).need;
    expect([...need].sort()).toEqual(['eventBus', 'mongo', 'postgres', 'valkey']);
  });

  it('mounts something for every group when its infrastructure is present', () => {
    for (const g of groups()) {
      expect(mountOf(g).imports.length).toBeGreaterThan(0);
    }
  });

  it('mounts nothing, rather than throwing, when a group’s stores are absent', () => {
    // A half-provisioned box should still boot and report itself not-ready, not crash-loop.
    const bare = loadConfig({
      SERVICE_NAME: 'composition-test',
      AUTH_DEV_INSECURE: 'true',
    } as NodeJS.ProcessEnv);
    const g = identityGroup(bare, logger);
    const infra = createInfraContext(
      { config: bare, logger, metrics: { registry: null } as never },
      { need: g.need },
    );
    expect(() => g.mount(infra)).not.toThrow();
    expect(g.mount(infra).imports).toHaveLength(0);
  });

  it('registers consumers separately from starting workers', () => {
    // The ordering guarantee the single-bus merge depends on: registration must be callable before
    // eventBus.start(), so these cannot be the same list.
    const m = mountOf(messagingGroup(config, logger));
    expect(m.register.length).toBeGreaterThan(0);
    expect(m.workers.length).toBeGreaterThan(0);
    expect(m.ensureIndexes.length).toBeGreaterThan(0);
  });
});

describe('mono is the same wiring, not a second implementation', () => {
  it('needs exactly the union of what the six services need', () => {
    const union = mergeNeeds(groups()).sort();
    const perGroup = [...new Set(groups().flatMap((g) => g.need))].sort();
    expect(union).toEqual(perGroup);
  });

  it('mounts the same modules the groups mount individually', () => {
    // This is the claim the mono profile rests on: one process is a re-composition of the same
    // groups, so nothing is added, dropped, or wired differently.
    const infra = createInfraContext(
      { config, logger, metrics: { registry: null } as never },
      { need: mergeNeeds(groups()) },
    );
    const merged = mergeMounted(groups().map((g) => g.mount(infra)));
    const summed = groups().reduce(
      (acc, g) => {
        const m = g.mount(infra);
        return {
          imports: acc.imports + m.imports.length,
          register: acc.register + m.register.length,
          workers: acc.workers + m.workers.length,
          ensureIndexes: acc.ensureIndexes + m.ensureIndexes.length,
        };
      },
      { imports: 0, register: 0, workers: 0, ensureIndexes: 0 },
    );

    expect(merged.imports).toHaveLength(summed.imports);
    expect(merged.register).toHaveLength(summed.register);
    expect(merged.workers).toHaveLength(summed.workers);
    expect(merged.ensureIndexes).toHaveLength(summed.ensureIndexes);
  });
});
