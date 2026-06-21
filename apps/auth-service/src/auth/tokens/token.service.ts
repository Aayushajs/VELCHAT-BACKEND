import jwt, { type JwtPayload } from 'jsonwebtoken';
import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { UnauthorizedError } from '@velchat/shared-utils';
import type { SigningKeyPair } from './keys';

export interface AccessClaims {
  account_id: string;
  device_id: string;
  tenant_id?: string;
  role?: string;
  scope?: string;
}

/** Persisted refresh-token record (token itself is never stored — only its hash). */
export interface RefreshRecord {
  id: string;
  deviceId: string;
  tokenHash: string;
  familyId: string;
  cnfJkt?: string;
  expiresAt: Date;
  revoked: boolean;
}

export interface RefreshStore {
  insert(rec: RefreshRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshRecord | null>;
  revoke(id: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}

export interface TokenServiceOptions {
  keyPair: SigningKeyPair;
  issuer: string;
  accessTtlSec: number;
  refreshTtlSec?: number;
}

/**
 * Token design §B2.3:
 *  - Access  = RS256 JWT (~15m), verifiable via JWKS.
 *  - Refresh = opaque, hashed-at-rest, ROTATING with REUSE-DETECTION (replay → revoke whole family).
 *  - DPoP    = refresh bound to the device key thumbprint (`cnf_jkt`); a stolen token can't be
 *    replayed from another device.
 */
export class TokenService {
  constructor(
    private readonly store: RefreshStore,
    private readonly opts: TokenServiceOptions,
  ) {}

  issueAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.opts.keyPair.privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: this.opts.accessTtlSec,
      issuer: this.opts.issuer,
      keyid: this.opts.keyPair.kid,
    });
  }

  verifyAccess(token: string): AccessClaims & JwtPayload {
    return jwt.verify(token, this.opts.keyPair.publicKeyPem, {
      algorithms: ['RS256'],
      issuer: this.opts.issuer,
    }) as AccessClaims & JwtPayload;
  }

  /** Public JWKS for resource servers to verify access tokens. */
  jwks(): { keys: Array<Record<string, unknown>> } {
    const jwk = createPublicKey(this.opts.keyPair.publicKeyPem).export({
      format: 'jwk',
    }) as Record<string, unknown>;
    return { keys: [{ ...jwk, kid: this.opts.keyPair.kid, use: 'sig', alg: 'RS256' }] };
  }

  async issueRefresh(
    deviceId: string,
    opts?: { familyId?: string; cnfJkt?: string },
  ): Promise<{ token: string; familyId: string }> {
    const token = randomBytes(32).toString('base64url');
    const familyId = opts?.familyId ?? randomUUID();
    await this.store.insert({
      id: randomUUID(),
      deviceId,
      tokenHash: sha256(token),
      familyId,
      cnfJkt: opts?.cnfJkt,
      expiresAt: new Date(Date.now() + (this.opts.refreshTtlSec ?? 30 * 24 * 3600) * 1000),
      revoked: false,
    });
    return { token, familyId };
  }

  /**
   * Rotate a refresh token. Presenting an ALREADY-ROTATED (revoked) token is replay → the entire
   * family is revoked (reuse detection). DPoP `cnf_jkt` must match the bound device key.
   */
  async rotateRefresh(
    presented: string,
    opts?: { cnfJkt?: string },
  ): Promise<{ token: string; familyId: string; deviceId: string }> {
    const rec = await this.store.findByHash(sha256(presented));
    if (!rec) throw new UnauthorizedError('Unknown refresh token');
    if (rec.revoked) {
      await this.store.revokeFamily(rec.familyId); // reuse detected → kill the family
      throw new UnauthorizedError('Refresh token reuse detected — token family revoked');
    }
    if (rec.expiresAt.getTime() < Date.now()) throw new UnauthorizedError('Refresh token expired');
    if (opts?.cnfJkt && rec.cnfJkt && rec.cnfJkt !== opts.cnfJkt) {
      throw new UnauthorizedError('DPoP key binding mismatch');
    }
    await this.store.revoke(rec.id);
    const next = await this.issueRefresh(rec.deviceId, {
      familyId: rec.familyId,
      cnfJkt: rec.cnfJkt,
    });
    return { ...next, deviceId: rec.deviceId };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
