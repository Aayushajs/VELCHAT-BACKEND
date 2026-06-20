import { loadConfig, kafkaBrokers, requirePostgresUrl } from './index';

describe('@velchat/config', () => {
  const base = { SERVICE_NAME: 'test-service' };

  it('applies defaults and coerces ports', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.HTTP_PORT).toBe(3000);
    expect(cfg.GRPC_PORT).toBe(50051);
    expect(typeof cfg.HTTP_PORT).toBe('number');
  });

  it('coerces numeric strings from env', () => {
    const cfg = loadConfig({ ...base, HTTP_PORT: '8080' } as NodeJS.ProcessEnv);
    expect(cfg.HTTP_PORT).toBe(8080);
  });

  it('fails closed when SERVICE_NAME is missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/Invalid environment configuration/);
  });

  it('fails closed on an invalid URL', () => {
    expect(() => loadConfig({ ...base, POSTGRES_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow(
      /POSTGRES_URL/,
    );
  });

  it('splits KAFKA_BROKERS into a list', () => {
    const cfg = loadConfig({ ...base, KAFKA_BROKERS: 'a:9092, b:9092' } as NodeJS.ProcessEnv);
    expect(kafkaBrokers(cfg)).toEqual(['a:9092', 'b:9092']);
  });

  it('requirePostgresUrl throws when absent', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(() => requirePostgresUrl(cfg)).toThrow(/POSTGRES_URL is required/);
  });

  it('returns a frozen object', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
