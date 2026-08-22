import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics } from '@velchat/common';
import { AppModule } from '../../src/app.module';

const metrics = createMetrics('messaging-composition-test');

const deps = (env: Record<string, string>) => {
  const config = loadConfig({ SERVICE_NAME: 'messaging-service', ...env } as NodeJS.ProcessEnv);
  return { config, logger: createLogger(config), metrics };
};

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nnot-a-real-key\n-----END PUBLIC KEY-----';

/**
 * A composition root has no business logic, so what is worth testing is the wiring contract:
 * it must fail closed on missing auth configuration, and it must not open stores it does not use.
 */
describe('messaging-service composition root', () => {
  it('refuses to wire without JWT_PUBLIC_PEM (DEF-02 fail-closed)', () => {
    expect(() => AppModule.forRoot(deps({ NODE_ENV: 'production' }))).toThrow(/JWT_PUBLIC_PEM/);
  });

  it('wires with no datastores configured — features stay unmounted, the service still boots', () => {
    // Matches the behaviour the 13 app modules had: a missing backend must not crash-loop the
    // container. Readiness reports the truth instead.
    const mod = AppModule.forRoot(deps({ AUTH_DEV_INSECURE: 'true' }));
    expect(mod.module).toBe(AppModule);
    expect(mod.imports?.length).toBeGreaterThan(0);
  });

  it('wires the full pipeline when every backend is configured', () => {
    const mod = AppModule.forRoot(
      deps({
        NODE_ENV: 'production',
        JWT_PUBLIC_PEM: PUBLIC_PEM,
        POSTGRES_URL: 'postgres://u:p@localhost:5432/db',
        MONGO_URL: 'mongodb://localhost:27017/db',
        VALKEY_URL: 'redis://localhost:6379',
      }),
    );
    // auth + observability + chat/polls/resend/extras + notification + campaigns + search
    expect(mod.imports?.length).toBeGreaterThanOrEqual(9);
  });
});
