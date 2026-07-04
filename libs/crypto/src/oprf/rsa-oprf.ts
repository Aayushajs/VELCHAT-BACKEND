import { createHash } from 'node:crypto';
import { modPow, modInverse, randomBigIntBelow, bigIntToBytes } from './bignum';
import { hashToBigInt } from './hash';
import type { OprfKeyMaterial } from './keys';

/**
 * RSA blind-signature OPRF (§G2 — "OPRF-based Private Set Intersection"). A Chaum-style blind
 * signature (cf. RFC 9474) used as an oblivious pseudo-random function: the CLIENT learns
 * f_d(number) = H(number)^d mod n without the SERVER ever seeing `number`, and the server's secret
 * exponent `d` cannot be recovered from any number of queries. Because computing a candidate
 * number's token requires this interactive round-trip, offline dictionary/enumeration attacks
 * against the small E.164 phone-number keyspace are impossible — every guess costs one
 * rate-limited request to an attested account (§B2.8), closing the loophole a plain salted hash
 * cannot close.
 *
 * Protocol:
 *   client:  blind(number)              -> { blinded, r }         (send `blinded` to the server)
 *   server:  evaluate(blinded, key)      -> evaluated              (blind RSA "sign"; server never
 *                                                                    learns `number`)
 *   client:  unblind(evaluated, r, key)  -> token                  (= directToken(number, key))
 * The server independently computes `directToken` for ITS OWN users' numbers at registration time
 * (no blinding needed — it already knows the plaintext number it's registering).
 */

export interface BlindedRequest {
  blinded: bigint;
  /** Kept client-side only; needed to unblind the server's response. Never sent to the server. */
  r: bigint;
}

/** Client step 1: blind the (normalized) phone number against the server's public (n, e). */
export function blind(
  input: string,
  pub: { n: bigint; e: bigint; nByteLength: number },
): BlindedRequest {
  const m = hashToBigInt(input, pub.n, pub.nByteLength);
  const r = randomBigIntBelow(pub.n);
  const blinded = (m * modPow(r, pub.e, pub.n)) % pub.n;
  return { blinded, r };
}

/** Server step: apply the secret exponent to the blinded value. Server never sees `input`. */
export function evaluate(blinded: bigint, key: Pick<OprfKeyMaterial, 'd' | 'n'>): bigint {
  return modPow(blinded, key.d, key.n);
}

function tokenFromUnblinded(unblinded: bigint, n: bigint, nByteLength: number): string {
  return createHash('sha256')
    .update(bigIntToBytes(unblinded % n, nByteLength))
    .digest('hex');
}

/** Client step 2: remove the blinding factor and hash to a fixed-size lookup token. */
export function unblind(
  evaluated: bigint,
  r: bigint,
  pub: { n: bigint; nByteLength: number },
): string {
  const rInv = modInverse(r, pub.n);
  const unblinded = (evaluated * rInv) % pub.n;
  return tokenFromUnblinded(unblinded, pub.n, pub.nByteLength);
}

/**
 * Server-side direct path: compute the same token for a number the server already knows in
 * plaintext (e.g. a user opting in to discovery at registration). No blinding round-trip needed —
 * this is mathematically identical to a client performing blind→evaluate→unblind on the same input.
 */
export function directToken(input: string, key: OprfKeyMaterial): string {
  const m = hashToBigInt(input, key.n, key.nByteLength);
  const evaluated = modPow(m, key.d, key.n);
  return tokenFromUnblinded(evaluated, key.n, key.nByteLength);
}
