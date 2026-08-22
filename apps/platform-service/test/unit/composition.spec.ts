import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, InfraLifecycle } from '@velchat/common';
import { AppModule } from '../../src/app.module';

/**
 * Which datastores a runtime service opens is an architectural decision, not an implementation
 * detail — so it is asserted here rather than described in a comment. Every backend is configured
 * below, which means a store missing from the expectation proves the root declared its needs
 * narrowly instead of inheriting whatever happened to be in the environment.
 */
const config = loadConfig({
  SERVICE_NAME: 'platform-service',
  NODE_ENV: 'test',
  AUTH_DEV_INSECURE: 'true',
  POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
  MONGO_URL: 'mongodb://localhost:27017/db',
  VALKEY_URL: 'redis://localhost:6379',
  CLOUDINARY_URL: 'cloudinary://k:s@cloud',
} as NodeJS.ProcessEnv);

function build() {
  const logger = createLogger(config);
  const module = AppModule.forRoot({
    config,
    logger,
    metrics: createMetrics('platform-service-test'),
  });
  const lifecycle = (module.providers ?? []).find(
    (p): p is { provide: unknown; useValue: InfraLifecycle } =>
      typeof p === 'object' && p !== null && 'provide' in p && p.provide === InfraLifecycle,
  )?.useValue;
  return { module, lifecycle };
}

describe('platform-service composition root', () => {
  it('builds without connecting to anything', () => {
    const { module, lifecycle } = build();
    expect(module.module).toBe(AppModule);
    expect(lifecycle).toBeInstanceOf(InfraLifecycle);
  });

  it('mounts its features (more than just the observability + auth modules)', () => {
    const { module } = build();
    expect((module.imports ?? []).length).toBeGreaterThan(2);
  });

  it('opens exactly the datastores it declared', () => {
    const { lifecycle } = build();
    // 'platform-pipeline' is the lifecycle step that registers consumers, starts the single bus,
    // then starts the workers — it is a managed resource too, and its presence is the assertion
    // that the one-bus-start discipline is wired.
    expect([...(lifecycle?.resourceNames ?? [])].sort()).toEqual(
      ['event-bus:redis-streams', 'indexes', 'mongo', 'pipeline', 'postgres', 'valkey'].sort(),
    );
  });
});
