import { OprfService } from '../../src/discovery/oprf.service';
import {
  blind,
  evaluate as cryptoEvaluate,
  unblind,
  directToken,
  base64UrlToBigInt,
  bigIntToBase64Url,
  deserializeOprfKey,
} from '@velchat/crypto';

function noopLogger() {
  return {
    info() {},
    warn() {},
    debug() {},
    error() {},
  } as unknown as import('@velchat/common').Logger;
}

describe('OprfService (§G2)', () => {
  function makeRepo() {
    const keys: Record<number, { version: number; n: string; e: string; d: string }> = {};
    let active: number | null = null;
    const tokens: Record<string, string> = {};
    return {
      getActiveKey: async () => (active !== null ? keys[active] : null),
      getKeyByVersion: async (v: number) => keys[v] ?? null,
      insertKey: async (version: number, n: string, e: string, d: string) => {
        keys[version] = { version, n, e, d };
        active = version;
        return keys[version];
      },
      maxVersion: async () => Math.max(0, ...Object.keys(keys).map(Number)),
      registerToken: async (token: string, accountId: string) => {
        tokens[token] = accountId;
      },
      removeAccountTokens: async (accountId: string) => {
        for (const t of Object.keys(tokens)) if (tokens[t] === accountId) delete tokens[t];
      },
      matchTokens: async (list: string[]) =>
        list.filter((t) => tokens[t]).map((t) => ({ token: t, account_id: tokens[t] })),
    };
  }

  function makeRateLimiter(allow = true) {
    return { allow: async () => allow } as unknown as import('@velchat/cache').RateLimiter;
  }

  it('getPublicKey lazily creates a key on first call and reuses it after', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    const k1 = await svc.getPublicKey();
    const k2 = await svc.getPublicKey();
    expect(k1.version).toBe(1);
    expect(k2).toEqual(k1);
  });

  it('rotateKey publishes a new higher version; evaluate against old version still works if requested', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    const k1 = await svc.getPublicKey();
    const k2 = await svc.rotateKey();
    expect(k2.version).toBe(k1.version + 1);
    const active = await svc.getPublicKey();
    expect(active.version).toBe(k2.version);
  });

  it('full discovery flow: register self, evaluate a lookup batch, match finds the registrant', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    const pubKey = await svc.getPublicKey();
    const pub = {
      n: base64UrlToBigInt(pubKey.n),
      e: base64UrlToBigInt(pubKey.e),
      nByteLength: Math.ceil(base64UrlToBigInt(pubKey.n).toString(2).length / 8),
    };

    // "self" registers by deriving its own token via the blind protocol (server never sees the number).
    const selfNumber = '+15550001111';
    const selfBlind = blind(selfNumber, pub);
    const selfEval = await svc.evaluateBatch('acct-self', [bigIntToBase64Url(selfBlind.blinded)]);
    const selfToken = unblind(base64UrlToBigInt(selfEval.evaluated[0]), selfBlind.r, pub);
    await svc.register('acct-self', selfToken, selfEval.version);

    // "lookup" account uploads an address book containing selfNumber + an unrelated number.
    const otherNumber = '+15550002222';
    const b1 = blind(selfNumber, pub);
    const b2 = blind(otherNumber, pub);
    const evalRes = await svc.evaluateBatch('acct-lookup', [
      bigIntToBase64Url(b1.blinded),
      bigIntToBase64Url(b2.blinded),
    ]);
    const t1 = unblind(base64UrlToBigInt(evalRes.evaluated[0]), b1.r, pub);
    const t2 = unblind(base64UrlToBigInt(evalRes.evaluated[1]), b2.r, pub);

    const { matches } = await svc.match('acct-lookup', [t1, t2]);
    expect(matches[t1]).toBe('acct-self');
    expect(matches[t2]).toBeUndefined();
  });

  it('evaluateBatch rejects an empty or oversized batch', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    await expect(svc.evaluateBatch('a', [])).rejects.toThrow(/non-empty/);
    const huge = Array.from({ length: 2001 }, () => 'AA');
    await expect(svc.evaluateBatch('a', huge)).rejects.toThrow(/too many/);
  });

  it('evaluateBatch is rate-limited per account', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(false), noopLogger());
    await expect(svc.evaluateBatch('acct', ['AA'])).rejects.toThrow(/Too many/);
  });

  it('match is rate-limited per account', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(false), noopLogger());
    await expect(svc.match('acct', ['deadbeef'])).rejects.toThrow(/Too many/);
  });

  it('register rejects a malformed token', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    await expect(svc.register('acct', 'not-a-sha256', 1)).rejects.toThrow(/sha256/);
  });

  it('unregister removes all of an account’s tokens', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    const token = 'a'.repeat(64);
    await svc.register('acct', token, 1);
    let res = await svc.match('someone', [token]);
    expect(res.matches[token]).toBe('acct');
    await svc.unregister('acct');
    res = await svc.match('someone', [token]);
    expect(res.matches[token]).toBeUndefined();
  });

  it('cross-checks against the crypto lib’s directToken (server-known path) for consistency', async () => {
    const repo = makeRepo();
    const svc = new OprfService(repo as never, makeRateLimiter(), noopLogger());
    const pubKey = await svc.getPublicKey();
    const row = await repo.getActiveKey();
    const key = deserializeOprfKey({ n: row!.n, e: row!.e, d: row!.d, version: row!.version });
    const number = '+15550009999';
    const pub = { n: key.n, e: key.e, nByteLength: key.nByteLength };
    const b = blind(number, pub);
    const evalRes = await svc.evaluateBatch('acct', [bigIntToBase64Url(b.blinded)]);
    const token = unblind(base64UrlToBigInt(evalRes.evaluated[0]), b.r, pub);
    expect(token).toBe(directToken(number, key));
    // sanity: evaluate() called directly matches the service's batch result too
    expect(cryptoEvaluate(b.blinded, key)).toBe(base64UrlToBigInt(evalRes.evaluated[0]));
  });
});
