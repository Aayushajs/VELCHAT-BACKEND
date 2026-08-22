import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, InfraLifecycle } from '@velchat/common';
import { AppModule } from '../../src/app.module';

/**
 * velchat-mono exists for boxes too small for six processes (Azure free is 1 GB). The property
 * worth pinning is that it is a RE-COMPOSITION, not a second implementation: it must open the union
 * of the six services' datastores and mount every feature group — nothing dropped, nothing extra.
 */
const config = loadConfig({
  SERVICE_NAME: 'velchat-mono',
  NODE_ENV: 'test',
  AUTH_DEV_INSECURE: 'true',
  POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
  MONGO_URL: 'mongodb://localhost:27017/db',
  VALKEY_URL: 'redis://localhost:6379',
  CLOUDINARY_URL: 'cloudinary://k:s@cloud',
} as NodeJS.ProcessEnv);

function build() {
  const logger = createLogger(config);
  const module = AppModule.forRoot({ config, logger, metrics: createMetrics('mono-test') });
  const lifecycle = (module.providers ?? []).find(
    (p): p is { provide: unknown; useValue: InfraLifecycle } =>
      typeof p === 'object' && p !== null && 'provide' in p && p.provide === InfraLifecycle,
  )?.useValue;
  return { module, lifecycle };
}

describe('velchat-mono composition root', () => {
  it('builds without connecting to anything', () => {
    const { module, lifecycle } = build();
    expect(module.module).toBe(AppModule);
    expect(lifecycle).toBeInstanceOf(InfraLifecycle);
  });

  it('opens the union of every group’s datastores', () => {
    const { lifecycle } = build();
    expect([...(lifecycle?.resourceNames ?? [])].sort()).toEqual(
      ['event-bus:redis-streams', 'indexes', 'mongo', 'pipeline', 'postgres', 'valkey'].sort(),
    );
  });

  it('mounts far more than a single group would', () => {
    // Five groups' worth of modules, plus the auth and observability modules.
    const { module } = build();
    expect((module.imports ?? []).length).toBeGreaterThan(10);
  });
});
