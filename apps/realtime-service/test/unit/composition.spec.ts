import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, InfraLifecycle } from '@velchat/common';
import type { InfraContext } from '@velchat/infra-context';
import { AppModule, INFRA } from '../../src/app.module';

/**
 * realtime-service holds every WebSocket, so it is the one process whose dependency list must stay
 * minimal — Valkey and the event bus, nothing else. Postgres and Mongo are BOTH configured below;
 * if either shows up, someone has re-coupled the socket tier to a store and every future deploy of
 * that store's features would drop live connections. That is the regression this test exists for.
 */
const config = loadConfig({
  SERVICE_NAME: 'realtime-service',
  NODE_ENV: 'test',
  AUTH_DEV_INSECURE: 'true',
  POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
  MONGO_URL: 'mongodb://localhost:27017/db',
  VALKEY_URL: 'redis://localhost:6379',
} as NodeJS.ProcessEnv);

function build() {
  const logger = createLogger(config);
  const module = AppModule.forRoot({ config, logger, metrics: createMetrics('realtime-test') });
  const provider = <T>(token: unknown): T | undefined =>
    (module.providers ?? []).find(
      (p): p is { provide: unknown; useValue: T } =>
        typeof p === 'object' && p !== null && 'provide' in p && p.provide === token,
    )?.useValue;
  return {
    module,
    lifecycle: provider<InfraLifecycle>(InfraLifecycle),
    infra: provider<InfraContext>(INFRA),
  };
}

describe('realtime-service composition root', () => {
  it('builds and exposes its infra to main.ts for the WebSocket fabric', () => {
    const { module, infra } = build();
    expect(module.module).toBe(AppModule);
    expect(infra?.valkey).toBeDefined();
    expect(module.exports).toContain(INFRA);
  });

  it('stays Valkey-only — no Postgres pool in the socket process', () => {
    const { lifecycle, infra } = build();
    expect([...(lifecycle?.resourceNames ?? [])].sort()).toEqual(
      ['event-bus:redis-streams', 'valkey'].sort(),
    );
    expect(infra?.postgres).toBeUndefined();
    expect(infra?.mongo).toBeUndefined();
  });

  it('shares one Valkey connection rather than opening a second for the fabric', () => {
    // The old realtime-gateway constructed its own ValkeyClient in main.ts on top of the module's.
    const { lifecycle } = build();
    const valkeys = [...(lifecycle?.resourceNames ?? [])].filter((n) => n === 'valkey');
    expect(valkeys).toHaveLength(1);
  });
});
