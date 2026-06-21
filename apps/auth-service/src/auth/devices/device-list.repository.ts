import { createHash } from 'node:crypto';
import type { PostgresClient } from '@velchat/database';
import {
  ktEntryHash,
  verifyKtChain,
  KT_GENESIS,
  type KtAction,
  type KtEntry,
} from './key-transparency';

export interface DeviceListEntry {
  deviceId: string;
  state: string;
  identityKeyHash: string | null;
}

export interface DeviceList {
  epoch: number;
  devices: DeviceListEntry[];
}

/**
 * Versioned device list + key-transparency store (§G1-3). Mutations atomically bump the account's
 * `device_list_epoch` and append a hash-chained log entry, so the epoch and the audit log can never
 * disagree. Identity tables are global (no RLS). Parameterized queries only.
 */
export class DeviceListRepository {
  constructor(private readonly pg: PostgresClient) {}

  async getEpoch(accountId: string): Promise<number> {
    const res = await this.pg.pool.query(
      'SELECT device_list_epoch FROM accounts WHERE account_id = $1',
      [accountId],
    );
    return Number(
      (res.rows[0] as { device_list_epoch: string } | undefined)?.device_list_epoch ?? 0,
    );
  }

  /** The list senders bind to: epoch + every device with its lifecycle state and bound identity key. */
  async getDeviceList(accountId: string): Promise<DeviceList> {
    const epoch = await this.getEpoch(accountId);
    const res = await this.pg.pool.query(
      'SELECT device_id, state, signal_identity_key FROM devices WHERE account_id = $1 AND revoked_at IS NULL',
      [accountId],
    );
    const devices = (
      res.rows as Array<{ device_id: string; state: string; signal_identity_key: Buffer | null }>
    ).map((r) => ({
      deviceId: r.device_id,
      state: r.state,
      identityKeyHash: r.signal_identity_key ? sha256(r.signal_identity_key) : null,
    }));
    return { epoch, devices };
  }

  /** Active devices only — the per-device fan-out targets (§B5.3). */
  async activeDeviceIds(accountId: string): Promise<string[]> {
    const res = await this.pg.pool.query(
      "SELECT device_id FROM devices WHERE account_id = $1 AND state = 'active' AND revoked_at IS NULL",
      [accountId],
    );
    return (res.rows as Array<{ device_id: string }>).map((r) => r.device_id);
  }

  /**
   * Transition a device's state, bump the epoch, and append a key-transparency entry — all in one
   * transaction so epoch ↔ log stay consistent. Returns the new epoch.
   */
  async transition(
    accountId: string,
    deviceId: string | null,
    action: KtAction,
    newState?: string,
  ): Promise<number> {
    const client = await this.pg.pool.connect();
    try {
      await client.query('BEGIN');
      const bumped = await client.query(
        'UPDATE accounts SET device_list_epoch = device_list_epoch + 1 WHERE account_id = $1 RETURNING device_list_epoch',
        [accountId],
      );
      const epoch = Number((bumped.rows[0] as { device_list_epoch: string }).device_list_epoch);

      let identityKeyHash: string | null = null;
      if (deviceId && newState) {
        const upd = await client.query(
          'UPDATE devices SET state = $2, revoked_at = CASE WHEN $2 = $3 THEN now() ELSE revoked_at END WHERE device_id = $1 RETURNING signal_identity_key',
          [deviceId, newState, 'revoked'],
        );
        const idk = (upd.rows[0] as { signal_identity_key: Buffer | null } | undefined)
          ?.signal_identity_key;
        identityKeyHash = idk ? sha256(idk) : null;
      }

      const prevRes = await client.query(
        'SELECT entry_hash FROM key_transparency_log WHERE account_id = $1 ORDER BY seq DESC LIMIT 1',
        [accountId],
      );
      const prevHash =
        (prevRes.rows[0] as { entry_hash: string } | undefined)?.entry_hash ?? KT_GENESIS;
      const ts = new Date().toISOString();
      const entryHash = ktEntryHash(prevHash, {
        accountId,
        deviceId,
        action,
        identityKeyHash,
        epoch,
        ts,
      });

      await client.query(
        `INSERT INTO key_transparency_log(account_id, device_id, action, identity_key_hash, epoch, prev_hash, entry_hash, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [accountId, deviceId, action, identityKeyHash, epoch, prevHash, entryHash, ts],
      );
      await client.query('COMMIT');
      return epoch;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Full chain for client-side audit (§G1-3). */
  async getChain(accountId: string): Promise<KtEntry[]> {
    const res = await this.pg.pool.query(
      'SELECT device_id, action, identity_key_hash, epoch, prev_hash, entry_hash, ts FROM key_transparency_log WHERE account_id = $1 ORDER BY seq ASC',
      [accountId],
    );
    return (
      res.rows as Array<{
        device_id: string | null;
        action: KtAction;
        identity_key_hash: string | null;
        epoch: string;
        prev_hash: string;
        entry_hash: string;
        ts: Date;
      }>
    ).map((r) => ({
      accountId,
      deviceId: r.device_id,
      action: r.action,
      identityKeyHash: r.identity_key_hash,
      epoch: Number(r.epoch),
      prevHash: r.prev_hash,
      entryHash: r.entry_hash,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    }));
  }

  /** Server-side integrity check; clients run the same verification independently. */
  async auditChain(accountId: string): Promise<boolean> {
    return verifyKtChain(await this.getChain(accountId)) === -1;
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
