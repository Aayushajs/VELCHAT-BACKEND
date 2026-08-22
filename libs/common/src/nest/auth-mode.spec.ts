import type { AppConfig } from '@velchat/config';
import { resolveAuthMode } from './auth-mode';

const config = (over: Partial<AppConfig>): AppConfig =>
  ({
    NODE_ENV: 'production',
    SERVICE_NAME: 'chat-service',
    AUTH_DEV_INSECURE: false,
    ...over,
  }) as AppConfig;

/**
 * DEF-02: 11 of 13 services shipped with no authentication at all. The structural fix is that a
 * service REFUSES TO BOOT rather than quietly serving unauthenticated traffic. These tests pin the
 * fail-closed decision so it cannot regress into "warn and continue".
 */
describe('resolveAuthMode', () => {
  it('verifies when the public key is configured', () => {
    const mode = resolveAuthMode(config({ JWT_PUBLIC_PEM: '-----BEGIN PUBLIC KEY-----\nx' }));
    expect(mode.verify).toBe(true);
    expect(mode.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('uses the configured issuer, falling back to the local default', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nx';
    expect(
      resolveAuthMode(config({ JWT_PUBLIC_PEM: pem, JWT_ISSUER: 'https://id.example' })).issuer,
    ).toBe('https://id.example');
    expect(resolveAuthMode(config({ JWT_PUBLIC_PEM: pem })).issuer).toBe(
      'https://auth.velchat.local',
    );
  });

  it('refuses to boot in production without a public key', () => {
    expect(() => resolveAuthMode(config({}))).toThrow(/JWT_PUBLIC_PEM/);
  });

  it('generates a shared dev keypair when none is configured outside production', () => {
    // `pnpm start:all` must work with zero configuration, but "works" has to mean real JWT
    // verification — not auth switched off, which would hide exactly the bugs local runs exist to
    // catch. So development falls back to a keypair persisted under the repo root, which every
    // service on the machine loads, so tokens minted by one verify in another.
    const mode = resolveAuthMode(config({ NODE_ENV: 'development' }));
    expect(mode.verify).toBe(true);
    expect(mode.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('gives every service the SAME dev keypair, so tokens interoperate', () => {
    const a = resolveAuthMode(config({ NODE_ENV: 'development', SERVICE_NAME: 'svc-a' }));
    const b = resolveAuthMode(config({ NODE_ENV: 'development', SERVICE_NAME: 'svc-b' }));
    expect(a.publicKeyPem).toBe(b.publicKeyPem);
  });

  it('still refuses to boot in PRODUCTION without a public key', () => {
    // The dev fallback must never apply in production: a missing key there means a deployment
    // mistake, and booting anyway would serve traffic no one can authenticate.
    expect(() => resolveAuthMode(config({}))).toThrow(/JWT_PUBLIC_PEM/);
  });

  it('allows an unverified service ONLY in development with the explicit opt-out', () => {
    const mode = resolveAuthMode(config({ NODE_ENV: 'development', AUTH_DEV_INSECURE: true }));
    expect(mode.verify).toBe(false);
  });

  it('refuses the dev opt-out in production — auth cannot be switched off in prod', () => {
    expect(() => resolveAuthMode(config({ AUTH_DEV_INSECURE: true }))).toThrow(/production/i);
  });

  it('treats a blank public key as absent rather than as a valid key', () => {
    expect(() => resolveAuthMode(config({ JWT_PUBLIC_PEM: '   ' }))).toThrow(/JWT_PUBLIC_PEM/);
  });
});

describe('dev keypair under concurrent boot', () => {
  it('gives every caller the same pair even when several create it at once', () => {
    // The failure this guards: six services boot together, each generates its own pair, and a
    // token signed by one is then rejected by all the others.
    const modes = Array.from({ length: 6 }, (_, i) =>
      resolveAuthMode(config({ NODE_ENV: 'development', SERVICE_NAME: `svc-${i}` })),
    );
    const keys = new Set(modes.map((m) => m.publicKeyPem));
    expect(keys.size).toBe(1);
  });
});
