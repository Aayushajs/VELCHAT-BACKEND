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

  // Regression: an env file has no multi-line form, so a deploy carries the PEM on one line with
  // escaped newlines. Four consumers read these and only one un-escaped, so the rest handed
  // jsonwebtoken a string it cannot parse — every token was rejected with "secretOrPublicKey must
  // be an asymmetric key" while the service looked healthy and served every route.
  describe('JWT PEM normalisation', () => {
    const NEWLINE = String.fromCharCode(10);
    const ESCAPED = String.fromCharCode(92) + 'n';
    const body =
      '-----BEGIN PUBLIC KEY-----' + ESCAPED + 'MIIBIjAN' + ESCAPED + '-----END PUBLIC KEY-----';

    it('turns escaped newlines into real ones', () => {
      const cfg = loadConfig({ ...base, JWT_PUBLIC_PEM: body } as NodeJS.ProcessEnv);
      expect(cfg.JWT_PUBLIC_PEM).toContain(NEWLINE);
      expect(cfg.JWT_PUBLIC_PEM).not.toContain(ESCAPED);
      expect(cfg.JWT_PUBLIC_PEM?.split(NEWLINE)).toHaveLength(3);
    });

    it('leaves a genuine multi-line PEM alone', () => {
      const multi =
        '-----BEGIN PUBLIC KEY-----' + NEWLINE + 'MIIBIjAN' + NEWLINE + '-----END PUBLIC KEY-----';
      const cfg = loadConfig({ ...base, JWT_PUBLIC_PEM: multi } as NodeJS.ProcessEnv);
      expect(cfg.JWT_PUBLIC_PEM).toBe(multi);
    });

    it('normalises the private half the same way', () => {
      const cfg = loadConfig({ ...base, JWT_PRIVATE_PEM: body } as NodeJS.ProcessEnv);
      expect(cfg.JWT_PRIVATE_PEM).toContain(NEWLINE);
    });

    it('leaves an unset value unset rather than turning it into an empty string', () => {
      const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
      expect(cfg.JWT_PUBLIC_PEM).toBeUndefined();
    });
  });
});
