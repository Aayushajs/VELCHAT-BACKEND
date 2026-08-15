import type { AuthEvents } from '../auth.events';
import type { DeviceList, DeviceListRepository } from './device-list.repository';

/**
 * Versioned, approval-gated device list (§G1-3). A device only becomes usable for E2EE fan-out after
 * it is APPROVED (by a trusted device or strong MFA via the DAPT flow) — the server alone can never
 * make one active. Every transition bumps the epoch, appends to the key-transparency log, and emits
 * `device.list.changed` so senders re-fetch the list and re-fan-out (defeats silent ghost devices).
 */
export class DeviceListService {
  constructor(
    private readonly repo: DeviceListRepository,
    private readonly events: AuthEvents,
  ) {}

  /** Senders fetch this and bind their ciphertext fan-out to `epoch`. */
  async getDeviceList(accountId: string): Promise<DeviceList> {
    return this.repo.getDeviceList(accountId);
  }

  /** A new device is proposed (post-attestation); not yet usable until approved. */
  async proposeDevice(accountId: string, deviceId: string): Promise<number> {
    return this.change(accountId, deviceId, 'proposed', 'proposed');
  }

  /** Trusted-device / MFA approval (DAPT) → device becomes active and joins fan-out. */
  async approveDevice(accountId: string, deviceId: string): Promise<number> {
    return this.change(accountId, deviceId, 'approved', 'active');
  }

  /** Revoke (lost/stolen/rotated) → dropped from fan-out; epoch bump kicks it from sender sessions. */
  async revokeDevice(accountId: string, deviceId: string): Promise<number> {
    return this.change(accountId, deviceId, 'revoked', 'revoked');
  }

  /** Verify the account's key-transparency chain is intact (clients run the same check). */
  async auditChain(accountId: string): Promise<boolean> {
    return this.repo.auditChain(accountId);
  }

  private async change(
    accountId: string,
    deviceId: string,
    action: 'proposed' | 'approved' | 'revoked',
    state: string,
  ): Promise<number> {
    const epoch = await this.repo.transition(accountId, deviceId, action, state);
    await this.events.deviceListChanged(accountId, epoch);
    return epoch;
  }
}
