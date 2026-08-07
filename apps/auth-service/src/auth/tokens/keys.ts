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
