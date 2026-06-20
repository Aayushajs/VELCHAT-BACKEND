import { TokenService, type RefreshRecord, type RefreshStore } from '../../src/auth/token.service';
import { loadOrGenerateKeyPair } from '../../src/auth/keys';

class MemoryRefreshStore implements RefreshStore {
  private byId = new Map<string, RefreshRecord>();
  async insert(rec: RefreshRecord): Promise<void> {
    this.byId.set(rec.id, { ...rec });
  }
  async findByHash(tokenHash: string): Promise<RefreshRecord | null> {
    for (const r of this.byId.values()) if (r.tokenHash === tokenHash) return { ...r };
    return null;
  }
  async revoke(id: string): Promise<void> {
    const r = this.byId.get(id);
    if (r) r.revoked = true;
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const r of this.byId.values()) if (r.familyId === familyId) r.revoked = true;
  }
}

function makeService() {
  const keyPair = loadOrGenerateKeyPair({});
  const store = new MemoryRefreshStore();
  const svc = new TokenService(store, {
    keyPair,
    issuer: 'https://auth.velchat.test',
    accessTtlSec: 900,
  });
  return { svc, store };
}

describe('TokenService (§B2.3)', () => {
  it('issues an RS256 access token that verifies with its claims', () => {
    const { svc } = makeService();
    const token = svc.issueAccess({ account_id: 'acc-1', device_id: 'dev-1', tenant_id: 'org-A' });
    const claims = svc.verifyAccess(token);
    expect(claims.account_id).toBe('acc-1');
    expect(claims.device_id).toBe('dev-1');
    expect(claims.tenant_id).toBe('org-A');
    expect(claims.iss).toBe('https://auth.velchat.test');
  });

  it('exposes a JWKS public key (RS256/sig)', () => {
    const { svc } = makeService();
    const jwks = svc.jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]?.alg).toBe('RS256');
    expect(jwks.keys[0]?.use).toBe('sig');
    expect(jwks.keys[0]?.kty).toBe('RSA');
  });

  it('rotates refresh tokens (new token each rotation)', async () => {
    const { svc } = makeService();
    const first = await svc.issueRefresh('dev-1');
    const second = await svc.rotateRefresh(first.token);
    expect(second.token).not.toBe(first.token);
    expect(second.familyId).toBe(first.familyId); // same family
    // the new token rotates again fine
    const third = await svc.rotateRefresh(second.token);
    expect(third.token).not.toBe(second.token);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { svc } = makeService();
    const first = await svc.issueRefresh('dev-1');
    const second = await svc.rotateRefresh(first.token); // first is now revoked

    // replay the OLD token → reuse detected
    await expect(svc.rotateRefresh(first.token)).rejects.toThrow(/reuse detected/i);

    // family is dead: even the previously-valid `second` token no longer rotates
    await expect(svc.rotateRefresh(second.token)).rejects.toThrow();
  });

  it('rejects a refresh with a mismatched DPoP key binding', async () => {
    const { svc } = makeService();
    const issued = await svc.issueRefresh('dev-1', { cnfJkt: 'thumb-A' });
    await expect(svc.rotateRefresh(issued.token, { cnfJkt: 'thumb-B' })).rejects.toThrow(/DPoP/i);
  });

  it('rejects an unknown refresh token', async () => {
    const { svc } = makeService();
    await expect(svc.rotateRefresh('not-a-real-token')).rejects.toThrow(/Unknown/i);
  });
});
