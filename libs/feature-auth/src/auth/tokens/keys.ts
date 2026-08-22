import { createHash } from 'node:crypto';
import { loadOrCreateDevKeyPair } from '@velchat/common';

export interface SigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
}

/**
 * Load the RS256 signing keypair.
 *
 * Production: from the environment, rotated via a secrets manager. Verifiers only need the public
 * half, which is why it is safe to hand `JWT_PUBLIC_PEM` to every service.
 *
 * Development: from the SAME shared, persisted pair that `resolveAuthMode` verifies against
 * (`.velchat-dev-keys/`). This used to mint an EPHEMERAL pair per process, which meant a token
 * signed here could not be verified anywhere else, and every restart invalidated every outstanding
 * token. Sharing one on-disk pair makes local multi-service auth actually work.
 */
/** Accept a PEM from an env var whether pasted multi-line OR single-line with `\n` escapes
 * (dashboards vary) — normalize the escapes so RS256 verify/sign always gets a valid PEM. */
function pemFromEnv(v: string | undefined): string | undefined {
  const s = v?.replace(/\\n/g, '\n').trim();
  return s || undefined;
}

export function loadOrGenerateKeyPair(env: {
  privatePem?: string;
  publicPem?: string;
}): SigningKeyPair {
  const priv = pemFromEnv(env.privatePem);
  const pub = pemFromEnv(env.publicPem);
  if (priv && pub) {
    return {
      privateKeyPem: priv,
      publicKeyPem: pub,
      kid: kidFor(pub),
    };
  }
  const dev = loadOrCreateDevKeyPair();
  return {
    privateKeyPem: dev.privateKeyPem,
    publicKeyPem: dev.publicKeyPem,
    kid: kidFor(dev.publicKeyPem),
  };
}

function kidFor(pem: string): string {
  return createHash('sha256').update(pem).digest('hex').slice(0, 16);
}
