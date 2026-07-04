import { createHash } from 'node:crypto';
import { bytesToBigInt } from './bignum';

/** MGF1 (RFC 8017 §B.2.1) — expands `seed` to `length` bytes using repeated SHA-256 + a counter. */
export function mgf1(seed: Buffer, length: number): Buffer {
  const hLen = 32; // sha256 digest length
  const chunks: Buffer[] = [];
  const iterations = Math.ceil(length / hLen);
  for (let counter = 0; counter < iterations; counter++) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter, 0);
    chunks.push(createHash('sha256').update(seed).update(c).digest());
  }
  return Buffer.concat(chunks).subarray(0, length);
}

/**
 * Hash an arbitrary input (the normalized phone number) to a BigInt uniformly distributed in
 * [0, n), for use as the RSA-OPRF message representative. Uses MGF1-over-SHA-256 (a standard,
 * well-documented KDF from PKCS#1 — not a custom primitive) to expand the digest to the modulus'
 * byte length, then reduces mod n.
 */
export function hashToBigInt(input: string, n: bigint, nByteLength: number): bigint {
  const seed = createHash('sha256').update('velchat-oprf-v1:').update(input).digest();
  const expanded = mgf1(seed, nByteLength);
  return bytesToBigInt(expanded) % n;
}
