import { loadConfig } from '@velchat/config';
import { createMetrics } from '@velchat/common';
import pino from 'pino';
import { createInfraContext } from './infra-context';

const logger = pino({ level: 'silent' });
const metrics = createMetrics('infra-context-test');

/** Every backend configured, so a test that finds a client absent proves `need` was respected. */
const fullConfig = () =>
  loadConfig({
    SERVICE_NAME: 'test-service',
    POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
    MONGO_URL: 'mongodb://localhost:27017/db',
    VALKEY_URL: 'redis://localhost:6379',
  } as NodeJS.ProcessEnv);

const ctx = (need: Parameters<typeof createInfraContext>[1]['need'], config = fullConfig()) =>
  createInfraContext({ config, logger, metrics }, { need });

/**
 * The reason this exists: every app.module repeated the same "if the URL is set, construct the
 * client" boilerplate, and the 13-service split meant ~39 pooled connections. Under the 6-service
 * topology a process must open ONLY the stores its features use — realtime-service in particular
 * has to stay Valkey-only, so that a status/media deploy can never drag Postgres into the process
 * holding every WebSocket.
 */
describe('createInfraContext', () => {
  it('opens only the clients that were asked for', () => {
    const infra = ctx(['valkey', 'eventBus']);

    expect(infra.valkey).toBeDefined();
    expect(infra.eventBus).toBeDefined();
    // Configured, deliberately NOT opened.
    expect(infra.postgres).toBeUndefined();
    expect(infra.mongo).toBeUndefined();
  });

  it('opens Postgres and Mongo when they are the declared need', () => {
    const infra = ctx(['postgres', 'mongo']);

    expect(infra.postgres).toBeDefined();
    expect(infra.mongo).toBeDefined();
    expect(infra.valkey).toBeUndefined();
  });

  it('skips a needed client whose configuration is absent, rather than throwing', () => {
    // Matches the behaviour the app modules already had: a missing backend leaves the feature
    // unmounted so the service still boots and reports itself unready, instead of crash-looping.
    const config = loadConfig({
      SERVICE_NAME: 'test-service',
      VALKEY_URL: 'redis://localhost:6379',
    } as NodeJS.ProcessEnv);

    const infra = ctx(['postgres', 'valkey'], config);

    expect(infra.postgres).toBeUndefined();
    expect(infra.valkey).toBeDefined();
  });

  it('reports availability so a composition root can decide what to mount', () => {
    const infra = ctx(['valkey']);

    expect(infra.has('valkey')).toBe(true);
    expect(infra.has('postgres')).toBe(false);
  });

  it('collects every constructed client as a managed resource for the lifecycle', () => {
    const infra = ctx(['postgres', 'mongo', 'valkey', 'eventBus']);

    const names = infra.managed.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['postgres', 'mongo', 'valkey']));
    expect(infra.managed).toHaveLength(4);
  });

  it('does not construct a client twice when a need is repeated', () => {
    const infra = ctx(['valkey', 'valkey', 'eventBus']);

    expect(infra.managed.filter((m) => m.name === 'valkey')).toHaveLength(1);
  });

  it('opens nothing when nothing is needed', () => {
    const infra = ctx([]);

    expect(infra.managed).toHaveLength(0);
    expect(infra.postgres).toBeUndefined();
    expect(infra.valkey).toBeUndefined();
  });
});
