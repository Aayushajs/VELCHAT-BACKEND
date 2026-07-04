import { randomBytes } from 'node:crypto';

/** Big-endian bytes → BigInt. */
export function bytesToBigInt(buf: Buffer): bigint {
  return BigInt('0x' + (buf.toString('hex') || '0'));
}

/** BigInt → big-endian bytes, left-padded to `byteLength`. */
export function bigIntToBytes(n: bigint, byteLength: number): Buffer {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length > byteLength) throw new RangeError('value does not fit in byteLength');
  if (buf.length === byteLength) return buf;
  return Buffer.concat([Buffer.alloc(byteLength - buf.length), buf]);
}

/** Modular exponentiation (square-and-multiply). `mod` must be positive. */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** Extended Euclidean algorithm: returns [gcd, x, y] such that a*x + b*y = gcd. */
function extGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x1, y1] = extGcd(b, a % b);
  return [g, y1, x1 - (a / b) * y1];
}

/** Modular inverse of `a` mod `m`. Throws if `a` and `m` are not coprime. */
export function modInverse(a: bigint, m: bigint): bigint {
  const [g, x] = extGcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error('modInverse: value is not invertible mod m (gcd != 1)');
  return ((x % m) + m) % m;
}

/**
 * A uniformly random BigInt in [2, max-1] via rejection sampling (avoids modulo bias) — used to
 * generate the blinding factor. The sampling width is derived from `max` itself (not caller-supplied)
 * so the acceptance rate is always ≥ ~50%: a mismatched byte length (e.g. sampling a 64-bit range for
 * a ~30-bit `max`) would make the loop reject nearly every draw — effectively an infinite, CPU-pinning
 * loop rather than a quick failure. Deriving the width internally makes that class of bug impossible.
 */
export function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.max(1, Math.ceil(max.toString(2).length / 8));
  for (;;) {
    const candidate = bytesToBigInt(randomBytes(byteLength));
    if (candidate >= 2n && candidate < max) return candidate;
  }
}

/** BigInt → base64url (unpadded), the wire/storage encoding used throughout the OPRF module. */
export function bigIntToBase64Url(n: bigint): string {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex').toString('base64url');
}

/** base64url → BigInt. Inverse of {@link bigIntToBase64Url}. */
export function base64UrlToBigInt(s: string): bigint {
  return bytesToBigInt(Buffer.from(s, 'base64url'));
}
