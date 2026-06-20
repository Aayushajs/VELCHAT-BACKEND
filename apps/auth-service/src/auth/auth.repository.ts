import { createHash } from 'node:crypto';
import { uuidv7 } from '@velchat/shared-utils';
import type { PostgresClient } from '../infra/clients/postgres.client';
import type { RefreshRecord, RefreshStore } from './token.service';

export interface DeviceRow {
  device_id: string;
  account_id: string;
  display_name: string | null;
  trusted: boolean;
  created_at: Date;
}

/**
 * auth-service data access. Identity tables are GLOBAL (not tenant-scoped) so we use the pool
 * directly (no RLS GUC). Parameterized queries only (CLAUDE.md §5). Implements the TokenService
 * RefreshStore over `refresh_tokens`.
 */
export class AuthRepository implements RefreshStore {
  constructor(private readonly pg: PostgresClient) {}

  async createAccount(tier: 'full' | 'limited'): Promise<string> {
    const accountId = uuidv7();
    await this.pg.pool.query('INSERT INTO accounts(account_id, status, tier) VALUES ($1, $2, $3)', [
      accountId,
      'active',
      tier,
    ]);
    return accountId;
  }

  /** Re-verifiable attribute. `value_hash` powers contact discovery / lookup (§B2.1). */
  async upsertVerifiedIdentifier(
    accountId: string,
    kind: 'phone' | 'email',
    valueNorm: string,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO identifiers(account_id, kind, value_norm, value_hash, verified_at, is_primary)
       VALUES ($1, $2, $3, $4, now(), true)`,
      [accountId, kind, valueNorm, sha256(valueNorm)],
    );
  }

  async addDevice(input: {
    accountId: string;
    platform: string;
    devicePubkey: Buffer;
    displayName?: string;
    trusted?: boolean;
  }): Promise<string> {
    const deviceId = uuidv7();
    await this.pg.pool.query(
      `INSERT INTO devices(device_id, account_id, platform, device_pubkey, display_name, trusted)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        deviceId,
        input.accountId,
        input.platform,
        input.devicePubkey,
        input.displayName ?? null,
        input.trusted ?? false,
      ],
    );
    return deviceId;
  }

  async accountForDevice(deviceId: string): Promise<string | null> {
    const res = await this.pg.pool.query('SELECT account_id FROM devices WHERE device_id = $1', [
      deviceId,
    ]);
    const row = res.rows[0] as { account_id: string } | undefined;
    return row?.account_id ?? null;
  }

  async listDevices(accountId: string): Promise<DeviceRow[]> {
    const res = await this.pg.pool.query(
      'SELECT device_id, account_id, display_name, trusted, created_at FROM devices WHERE account_id = $1 AND revoked_at IS NULL',
      [accountId],
    );
    return res.rows as DeviceRow[];
  }

  async audit(event: string, accountId?: string, deviceId?: string, ip?: string): Promise<void> {
    await this.pg.pool.query(
      'INSERT INTO auth_audit(account_id, event, device_id, ip) VALUES ($1, $2, $3, $4)',
      [accountId ?? null, event, deviceId ?? null, ip ?? null],
    );
  }

  // ── RefreshStore (§B2.3) ─────────────────────────────────────────────────
  async insert(rec: RefreshRecord): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO refresh_tokens(id, device_id, token_hash, family_id, cnf_jkt, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        rec.id,
        rec.deviceId,
        rec.tokenHash,
        rec.familyId,
        rec.cnfJkt ?? null,
        rec.expiresAt,
        rec.revoked,
      ],
    );
  }

  async findByHash(tokenHash: string): Promise<RefreshRecord | null> {
    const res = await this.pg.pool.query(
      'SELECT id, device_id, token_hash, family_id, cnf_jkt, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    const row = res.rows[0] as
      | {
          id: string;
          device_id: string;
          token_hash: string;
          family_id: string;
          cnf_jkt: string | null;
          expires_at: Date;
          revoked: boolean;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      deviceId: row.device_id,
      tokenHash: row.token_hash,
      familyId: row.family_id,
      cnfJkt: row.cnf_jkt ?? undefined,
      expiresAt: row.expires_at,
      revoked: row.revoked,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.pg.pool.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [id]);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.pg.pool.query('UPDATE refresh_tokens SET revoked = true WHERE family_id = $1', [
      familyId,
    ]);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
