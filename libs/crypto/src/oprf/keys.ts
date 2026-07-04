import { generateKeyPairSync } from 'node:crypto';
import { base64UrlToBigInt, bigIntToBase64Url } from './bignum';

export interface OprfKeyMaterial {
  /** RSA modulus. */
  n: bigint;
  /** RSA public exponent (only used to derive/verify the key; not needed for evaluate). */
  e: bigint;
  /** RSA private exponent — the server's secret OPRF key. NEVER leaves the server. */
  d: bigint;
  /** Byte length of `n` (for fixed-width serialization / hash expansion). */
  nByteLength: number;
  /** Rotation version — bump when the key rotates; old tokens become unverifiable (§G2). */
  version: number;
}

/** Serialized form for storage (Postgres) — base64url big-integers, safe to persist as text. */
export interface OprfKeyRecord {
  n: string;
  e: string;
  d: string;
  version: number;
}

/**
 * Generate a fresh RSA-OPRF key pair (§G2). Uses Node's audited `crypto.generateKeyPairSync` for
 * the actual RSA key material (we do not implement prime generation ourselves) and JWK export to
 * recover n/e/d as big integers for the blind-signature OPRF math in rsa-oprf.ts.
 */
export function generateOprfKey(version: number, modulusLength = 2048): OprfKeyMaterial {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength });
  const jwk = privateKey.export({ format: 'jwk' }) as { n?: string; e?: string; d?: string };
  if (!jwk.n || !jwk.e || !jwk.d) throw new Error('RSA JWK export missing n/e/d');
  const n = base64UrlToBigInt(jwk.n);
  return {
    n,
    e: base64UrlToBigInt(jwk.e),
    d: base64UrlToBigInt(jwk.d),
    nByteLength: Math.ceil(n.toString(2).length / 8),
    version,
  };
}

export function serializeOprfKey(k: OprfKeyMaterial): OprfKeyRecord {
  return {
    n: bigIntToBase64Url(k.n),
    e: bigIntToBase64Url(k.e),
    d: bigIntToBase64Url(k.d),
    version: k.version,
  };
}

export function deserializeOprfKey(r: OprfKeyRecord): OprfKeyMaterial {
  const n = base64UrlToBigInt(r.n);
  return {
    n,
    e: base64UrlToBigInt(r.e),
    d: base64UrlToBigInt(r.d),
    nByteLength: Math.ceil(n.toString(2).length / 8),
    version: r.version,
  };
}
