import { createHash } from 'node:crypto';
import { uuidv7 } from '@velchat/shared-utils';
import type { PostgresClient } from '@velchat/database';
import type { RefreshRecord, RefreshStore } from './tokens/token.service';

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

  async getDevice(
    deviceId: string,
  ): Promise<{ accountId: string; trusted: boolean; pubkey: Buffer } | null> {
    const res = await this.pg.pool.query(
      'SELECT account_id, trusted, device_pubkey FROM devices WHERE device_id = $1 AND revoked_at IS NULL',
      [deviceId],
    );
    const row = res.rows[0] as
      | { account_id: string; trusted: boolean; device_pubkey: Buffer }
      | undefined;
    return row
      ? { accountId: row.account_id, trusted: row.trusted, pubkey: row.device_pubkey }
      : null;
  }

  async getDevicePubkey(deviceId: string): Promise<Buffer | null> {
    const res = await this.pg.pool.query(
      'SELECT device_pubkey FROM devices WHERE device_id = $1 AND revoked_at IS NULL',
      [deviceId],
    );
    const row = res.rows[0] as { device_pubkey: Buffer } | undefined;
    return row?.device_pubkey ?? null;
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

  // ── Passkeys (WebAuthn, §B2.1) — cred_id stored as bytea ─────────────────
  async insertPasskey(
    accountId: string,
    credIdB64url: string,
    publicKey: Buffer,
    counter: number,
  ): Promise<void> {
    await this.pg.pool.query(
      'INSERT INTO passkeys(cred_id, account_id, public_key, sign_count) VALUES ($1, $2, $3, $4)',
      [Buffer.from(credIdB64url, 'base64url'), accountId, publicKey, counter],
    );
  }

  async listPasskeyCredIds(accountId: string): Promise<string[]> {
    const res = await this.pg.pool.query('SELECT cred_id FROM passkeys WHERE account_id = $1', [
      accountId,
    ]);
    return (res.rows as Array<{ cred_id: Buffer }>).map((r) => r.cred_id.toString('base64url'));
  }

  async getPasskeyByCredId(
    credIdB64url: string,
  ): Promise<{ accountId: string; publicKey: Buffer; counter: number } | null> {
    const res = await this.pg.pool.query(
      'SELECT account_id, public_key, sign_count FROM passkeys WHERE cred_id = $1',
      [Buffer.from(credIdB64url, 'base64url')],
    );
    const row = res.rows[0] as
      | { account_id: string; public_key: Buffer; sign_count: string | number }
      | undefined;
    return row
      ? { accountId: row.account_id, publicKey: row.public_key, counter: Number(row.sign_count) }
      : null;
  }

  async updatePasskeyCounter(credIdB64url: string, counter: number): Promise<void> {
    await this.pg.pool.query('UPDATE passkeys SET sign_count = $2 WHERE cred_id = $1', [
      Buffer.from(credIdB64url, 'base64url'),
      counter,
    ]);
  }

  // ── Number change (§B2.6) ────────────────────────────────────────────────
  async findVerifiedPhoneAccount(phoneNorm: string): Promise<string | null> {
    const res = await this.pg.pool.query(
      "SELECT account_id FROM identifiers WHERE kind = 'phone' AND value_norm = $1 AND verified_at IS NOT NULL",
      [phoneNorm],
    );
    const row = res.rows[0] as { account_id: string } | undefined;
    return row?.account_id ?? null;
  }

  /** Atomically re-point the account's phone identifier to a new number on the SAME account_id. */
  async repointPhone(accountId: string, newNorm: string): Promise<void> {
    const client = await this.pg.pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        "UPDATE identifiers SET value_norm = $2, value_hash = $3, verified_at = now() WHERE account_id = $1 AND kind = 'phone'",
        [accountId, newNorm, sha256(newNorm)],
      );
      if (upd.rowCount === 0) {
        await client.query(
          "INSERT INTO identifiers(account_id, kind, value_norm, value_hash, verified_at, is_primary) VALUES ($1, 'phone', $2, $3, now(), true)",
          [accountId, newNorm, sha256(newNorm)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Full session revocation for an account's device (recovery / device-loss, §B2.7). */
  async revokeDeviceTokens(deviceId: string): Promise<void> {
    await this.pg.pool.query('UPDATE refresh_tokens SET revoked = true WHERE device_id = $1', [
      deviceId,
    ]);
  }

  // ── Recovery backup codes (§B2.7) ────────────────────────────────────────
  async storeBackupCodes(accountId: string, codeHashes: string[]): Promise<void> {
    await this.pg.pool.query('DELETE FROM recovery_backup_codes WHERE account_id = $1', [
      accountId,
    ]);
    for (const codeHash of codeHashes) {
      await this.pg.pool.query(
        'INSERT INTO recovery_backup_codes(account_id, code_hash, used) VALUES ($1, $2, false)',
        [accountId, codeHash],
      );
    }
  }

  /** Consume a backup code (single-use). Returns true if a matching unused code was found. */
  async consumeBackupCode(accountId: string, codeHash: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      'UPDATE recovery_backup_codes SET used = true WHERE account_id = $1 AND code_hash = $2 AND used = false RETURNING id',
      [accountId, codeHash],
    );
    return (res.rowCount ?? 0) > 0;
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
