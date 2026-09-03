import { generateKeyPairSync } from 'node:crypto';
import { loadOrGenerateKeyPair } from '../../src/auth/tokens/keys';

/**
 * Regression: AuthModule read `process.env.JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`, but the config
 * schema, every .env template and the deploy docs use `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM`.
 * Nothing ever set the `_KEY` names, so the configured pair was silently ignored and the dev
 * fallback ran in production: tokens were re-signed with a fresh key on every restart, the
 * documented "refuse to boot without JWT_PUBLIC_PEM" guarantee could never trigger, and inside a
 * container the fallback died on EACCES writing .velchat-dev-keys.
 *
 * These tests pin the behaviour the caller depends on rather than the wiring itself, so they stay
 * meaningful if AuthModule is refactored.
 */
function realPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

describe('loadOrGenerateKeyPair', () => {
  it('uses a supplied multi-line PEM pair rather than generating one', () => {
    const { privateKey, publicKey } = realPair();
    const kp = loadOrGenerateKeyPair({ privatePem: privateKey, publicPem: publicKey });
    expect(kp.publicKeyPem.trim()).toBe(publicKey.trim());
    expect(kp.privateKeyPem.trim()).toBe(privateKey.trim());
  });

  // An env file has no multi-line form, so deploys carry the PEM on one line with literal \n.
  it('accepts a single-line PEM with escaped newlines', () => {
    const { privateKey, publicKey } = realPair();
    const kp = loadOrGenerateKeyPair({
      privatePem: privateKey.replace(/\n/g, '\\n'),
      publicPem: publicKey.replace(/\n/g, '\\n'),
    });
    expect(kp.publicKeyPem.trim()).toBe(publicKey.trim());
    expect(kp.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    expect(kp.privateKeyPem).not.toContain('\\n');
  });

  it('derives a stable kid from the public key, so restarts keep verifying old tokens', () => {
    const { privateKey, publicKey } = realPair();
    const a = loadOrGenerateKeyPair({ privatePem: privateKey, publicPem: publicKey });
    const b = loadOrGenerateKeyPair({ privatePem: privateKey, publicPem: publicKey });
    expect(a.kid).toBe(b.kid);
    expect(a.kid).toBeTruthy();
  });

  // Half a pair is a misconfiguration; silently signing with a generated key would be worse than
  // falling back visibly, so this documents which way it goes.
  it('does not accept a half-configured pair', () => {
    const { publicKey } = realPair();
    const kp = loadOrGenerateKeyPair({ privatePem: undefined, publicPem: publicKey });
    expect(kp.publicKeyPem.trim()).not.toBe(publicKey.trim());
  });
});
