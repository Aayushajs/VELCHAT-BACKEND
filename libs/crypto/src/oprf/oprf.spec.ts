import { modPow, modInverse, bytesToBigInt, bigIntToBytes, randomBigIntBelow } from './bignum';
import { hashToBigInt, mgf1 } from './hash';
import { generateOprfKey, serializeOprfKey, deserializeOprfKey } from './keys';
import { blind, evaluate, unblind, directToken } from './rsa-oprf';

describe('bignum', () => {
  it('bytesToBigInt / bigIntToBytes round-trip', () => {
    const buf = Buffer.from('deadbeef', 'hex');
    const n = bytesToBigInt(buf);
    expect(n).toBe(0xdeadbeefn);
    expect(bigIntToBytes(n, 4).toString('hex')).toBe('deadbeef');
  });

  it('bigIntToBytes left-pads to the requested length', () => {
    expect(bigIntToBytes(1n, 4).toString('hex')).toBe('00000001');
  });

  it('modPow matches naive exponentiation for small values', () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n); // known RSA textbook example
    expect(modPow(2n, 10n, 1000n)).toBe(24n); // 1024 mod 1000
    expect(modPow(5n, 0n, 97n)).toBe(1n);
  });

  it('modInverse: a * inverse(a) ≡ 1 (mod m)', () => {
    const m = 3233n; // 61*53
    const a = 17n;
    const inv = modInverse(a, m);
    expect((a * inv) % m).toBe(1n);
  });

  it('modInverse throws for non-coprime input', () => {
    expect(() => modInverse(6n, 9n)).toThrow(/not invertible/);
  });

  it('randomBigIntBelow stays in range and varies', () => {
    const max = 1000000007n;
    const vals = new Set<bigint>();
    for (let i = 0; i < 20; i++) {
      const r = randomBigIntBelow(max);
      expect(r >= 2n && r < max).toBe(true);
      vals.add(r);
    }
    expect(vals.size).toBeGreaterThan(1); // not constant
  });

  it('acceptance rate stays fast for a modulus much smaller than a byte boundary (regression)', () => {
    // A previous bug let callers pass a mismatched sampling width, making the rejection loop
    // reject almost every draw for a small `max` — effectively hanging. Deriving the width from
    // `max` internally fixes this; this is a fast smoke test that it stays fast.
    const max = 7n; // tiny range — would be pathological if the byte width were ever oversized
    for (let i = 0; i < 50; i++) {
      const r = randomBigIntBelow(max);
      expect(r >= 2n && r < max).toBe(true);
    }
  });
});

describe('hash (MGF1 + hashToBigInt)', () => {
  it('mgf1 expands to the exact requested length', () => {
    expect(mgf1(Buffer.from('seed'), 50)).toHaveLength(50);
    expect(mgf1(Buffer.from('seed'), 5)).toHaveLength(5);
  });

  it('hashToBigInt is deterministic and always < n', () => {
    const n = 2n ** 2048n - 1n; // arbitrary large modulus for the range check
    const a = hashToBigInt('+15550001111', n, 256);
    const b = hashToBigInt('+15550001111', n, 256);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0n);
    expect(a).toBeLessThan(n);
  });

  it('different inputs hash to different values (no collisions in practice)', () => {
    const n = 2n ** 2048n - 1n;
    const a = hashToBigInt('+15550001111', n, 256);
    const b = hashToBigInt('+15550001112', n, 256);
    expect(a).not.toBe(b);
  });
});

describe('RSA-OPRF protocol (§G2)', () => {
  // Generated in beforeAll (not eagerly at describe-body scope): synchronous RSA keygen executed
  // during Jest's test-collection phase can hang on some Node/Jest/platform combos since collection
  // isn't subject to the per-test timeout. beforeAll runs under Jest's normal hook timeout instead.
  // A small modulus keeps the suite fast; the protocol logic exercised is identical regardless of
  // key size — production uses generateOprfKey's 2048-bit default (see oprf.service.ts).
  let key: ReturnType<typeof generateOprfKey>;
  let pub: { n: bigint; e: bigint; nByteLength: number };

  beforeAll(() => {
    key = generateOprfKey(1, 512);
    pub = { n: key.n, e: key.e, nByteLength: key.nByteLength };
  });

  it('blind → evaluate → unblind yields the same token as the direct (server-known) path', () => {
    const number = '+15550001111';
    const { blinded, r } = blind(number, pub);
    const evaluated = evaluate(blinded, key);
    const token = unblind(evaluated, r, pub);
    expect(token).toBe(directToken(number, key));
    expect(token).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('is a deterministic PRF: same input always yields the same token, across independent blinds', () => {
    const number = '+15550009999';
    const t1 = directToken(number, key);
    // Each run re-blinds with a fresh random r; the final token must still match every time.
    const run = () => {
      const b = blind(number, pub);
      return unblind(evaluate(b.blinded, key), b.r, pub);
    };
    expect(run()).toBe(t1);
    expect(run()).toBe(t1);
    expect(run()).toBe(t1);
  });

  it('different numbers never collide', () => {
    expect(directToken('+15550001111', key)).not.toBe(directToken('+15550002222', key));
  });

  it('blinding hides the number: the blinded value differs from the raw hash and from run to run', () => {
    const number = '+15550001111';
    const a = blind(number, pub);
    const b = blind(number, pub);
    // Same number, two independent blinds → different wire values (random r each time).
    expect(a.blinded).not.toBe(b.blinded);
    // But both unblind to the identical token.
    expect(unblind(evaluate(a.blinded, key), a.r, pub)).toBe(
      unblind(evaluate(b.blinded, key), b.r, pub),
    );
  });

  it('a wrong blinding factor does NOT unblind to the correct token (integrity sanity check)', () => {
    const number = '+15550001111';
    const { blinded } = blind(number, pub);
    const evaluated = evaluate(blinded, key);
    const wrongR = blind('+19998887777', pub).r; // a different, unrelated blinding factor
    expect(unblind(evaluated, wrongR, pub)).not.toBe(directToken(number, key));
  });

  it('rotating the key changes the token (old tokens are unverifiable after rotation, §G2)', () => {
    const key2 = generateOprfKey(2, 512);
    expect(directToken('+15550001111', key)).not.toBe(directToken('+15550001111', key2));
  });

  it('serialize/deserialize round-trips key material exactly', () => {
    const record = serializeOprfKey(key);
    const restored = deserializeOprfKey(record);
    expect(restored.n).toBe(key.n);
    expect(restored.e).toBe(key.e);
    expect(restored.d).toBe(key.d);
    expect(restored.version).toBe(key.version);
    // functionally identical: produces the same token
    expect(directToken('+15550001111', restored)).toBe(directToken('+15550001111', key));
  });
});
