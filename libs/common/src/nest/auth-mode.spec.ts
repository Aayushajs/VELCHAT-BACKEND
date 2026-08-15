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

  it('refuses to boot in development without a public key and without the explicit opt-out', () => {
    expect(() => resolveAuthMode(config({ NODE_ENV: 'development' }))).toThrow(/JWT_PUBLIC_PEM/);
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
