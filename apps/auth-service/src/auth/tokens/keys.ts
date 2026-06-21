import { generateKeyPairSync, createHash } from 'node:crypto';

export interface SigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
}

/**
 * Load the RS256 signing keypair from env (prod: rotated via JWKS / secrets manager) or generate
 * an ephemeral dev keypair. The access token is RS256 so verifiers only need the public JWKS.
 */
export function loadOrGenerateKeyPair(env: {
  privatePem?: string;
  publicPem?: string;
}): SigningKeyPair {
  if (env.privatePem && env.publicPem) {
    return {
      privateKeyPem: env.privatePem,
      publicKeyPem: env.publicPem,
      kid: kidFor(env.publicPem),
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey, kid: kidFor(publicKey) };
}

function kidFor(pem: string): string {
  return createHash('sha256').update(pem).digest('hex').slice(0, 16);
}
