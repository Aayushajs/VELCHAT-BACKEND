import type { Redis } from 'ioredis';
import { uuidv7, ValidationError, NotFoundError, UnauthorizedError } from '@velchat/shared-utils';
import { AuthRepository, type DeviceRow } from './auth.repository';
import { TokenService } from './token.service';
import { ReverseOtpService, type InboundProof } from './reverse-otp.service';
import { DeviceKeyService } from './device-key.service';
import { MagicLinkService } from './magic-link.service';
import { ApproveDeviceService } from './approve-device.service';
import { AuthEvents } from './auth.events';

export interface RegisterInput {
  phone: string;
  platform: string;
  devicePubkeyBase64: string;
}

export interface Tokens {
  accountId: string;
  deviceId: string;
  access: string;
  refresh: string;
  expiresIn: number;
}

/**
 * Orchestrates the cold-start registration state machine (§B2.4 / flow C1):
 * ENTER_NUMBER → REVERSE_OTP_PENDING → [verify §B2.2] → PROVISION → ACTIVE(full).
 * Identity = account_id (UUIDv7); phone is a re-verifiable identifier (§B2.1).
 */
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly revotp: ReverseOtpService,
    private readonly deviceKey: DeviceKeyService,
    private readonly magicLink: MagicLinkService,
    private readonly approve: ApproveDeviceService,
    private readonly events: AuthEvents,
    private readonly redis: Redis,
    private readonly accessTtlSec: number,
  ) {}

  /** Issue an access + refresh pair for an (account, device). */
  private async mintTokens(accountId: string, deviceId: string): Promise<Tokens> {
    const access = this.tokens.issueAccess({
      account_id: accountId,
      device_id: deviceId,
      scope: 'full',
    });
    const { token: refresh } = await this.tokens.issueRefresh(deviceId);
    return { accountId, deviceId, access, refresh, expiresIn: this.accessTtlSec };
  }

  /** §B2.5 same-device login (step 1): issue a nonce for the device to sign. */
  async challenge(deviceId: string): Promise<{ nonce: string; expiresIn: number }> {
    return this.deviceKey.challenge(deviceId);
  }

  /** §B2.5 same-device login (step 2): verify the device-key signature → issue tokens (no OTP). */
  async loginWithDeviceKey(deviceId: string, signatureB64: string): Promise<Tokens> {
    const pubkey = await this.repo.getDevicePubkey(deviceId);
    if (!pubkey) throw new NotFoundError('Unknown or revoked device');
    await this.deviceKey.verify(deviceId, signatureB64, pubkey);
    const accountId = await this.accountForDevice(deviceId);
    const access = this.tokens.issueAccess({
      account_id: accountId,
      device_id: deviceId,
      scope: 'full',
    });
    const { token: refresh } = await this.tokens.issueRefresh(deviceId);
    await this.repo.audit('login.device-key', accountId, deviceId);
    return { accountId, deviceId, access, refresh, expiresIn: this.accessTtlSec };
  }

  /** Step 1: user enters a number → start a Reverse-OTP session (₹0). */
  async register(input: RegisterInput): Promise<{ sessionId: string; expiresIn: number }> {
    if (!input.phone || !input.platform || !input.devicePubkeyBase64) {
      throw new ValidationError('phone, platform and devicePubkeyBase64 are required');
    }
    const sessionId = uuidv7();
    const { expiresAt } = await this.revotp.start(input.phone, sessionId);
    // Remember the device material to provision once the webhook confirms the proof.
    await this.redis.set(
      `revotp:input:${sessionId}`,
      JSON.stringify({ platform: input.platform, devicePubkeyBase64: input.devicePubkeyBase64 }),
      'EX',
      300,
    );
    return { sessionId, expiresIn: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) };
  }

  /**
   * Step 2: the Asterisk/FreeSWITCH webhook reports the proof. We run anti-spoof (§B2.2); on pass
   * we PROVISION account + verified identifier + device, mint tokens, and emit events.
   */
  async handleReverseOtpWebhook(proof: InboundProof): Promise<{ verified: true }> {
    const { phone } = await this.revotp.verify(proof);

    const raw = await this.redis.get(`revotp:input:${proof.sessionId}`);
    if (!raw) throw new NotFoundError('Registration session expired');
    const input = JSON.parse(raw) as { platform: string; devicePubkeyBase64: string };

    const accountId = await this.repo.createAccount('full');
    await this.repo.upsertVerifiedIdentifier(accountId, 'phone', phone);
    const deviceId = await this.repo.addDevice({
      accountId,
      platform: input.platform,
      devicePubkey: Buffer.from(input.devicePubkeyBase64, 'base64'),
      trusted: true, // first device is trusted (can approve future devices)
    });

    const access = this.tokens.issueAccess({
      account_id: accountId,
      device_id: deviceId,
      scope: 'full',
    });
    const { token: refresh } = await this.tokens.issueRefresh(deviceId);

    await this.redis.set(
      `revotp:result:${proof.sessionId}`,
      JSON.stringify({ accountId, deviceId, access, refresh, expiresIn: this.accessTtlSec }),
      'EX',
      120,
    );
    await this.repo.audit('user.registered', accountId, deviceId);
    await this.events.userCreated(accountId);
    await this.events.deviceAdded(accountId, deviceId, true);
    return { verified: true };
  }

  /** Step 3: the client fetches its freshly provisioned tokens once its device completed the call. */
  async getSession(sessionId: string): Promise<Tokens> {
    const raw = await this.redis.get(`revotp:result:${sessionId}`);
    if (!raw) throw new NotFoundError('No completed session — verify the number first');
    await this.redis.del(`revotp:result:${sessionId}`); // one-time fetch
    return JSON.parse(raw) as Tokens;
  }

  /** Rotating refresh with reuse-detection + DPoP (§B2.3). Issues a fresh access token too. */
  async refresh(presented: string, cnfJkt?: string): Promise<Omit<Tokens, never>> {
    const rotated = await this.tokens.rotateRefresh(presented, { cnfJkt });
    const accountId = await this.accountForDevice(rotated.deviceId);
    const access = this.tokens.issueAccess({
      account_id: accountId,
      device_id: rotated.deviceId,
      scope: 'full',
    });
    return {
      accountId,
      deviceId: rotated.deviceId,
      access,
      refresh: rotated.token,
      expiresIn: this.accessTtlSec,
    };
  }

  // ── DAPT fallback: email magic-link (§B2.5, limited tier) ────────────────
  async magicLinkBegin(input: {
    email: string;
    platform: string;
    devicePubkeyBase64: string;
  }): Promise<{ sent: true }> {
    if (!input.email || !input.platform || !input.devicePubkeyBase64) {
      throw new ValidationError('email, platform and devicePubkeyBase64 are required');
    }
    return this.magicLink.begin({
      email: input.email,
      platform: input.platform,
      devicePubkeyDer: input.devicePubkeyBase64,
    });
  }

  async magicLinkVerify(token: string): Promise<Tokens> {
    const pending = await this.magicLink.consume(token);
    const accountId = await this.repo.createAccount('limited'); // email-only → limited tier
    await this.repo.upsertVerifiedIdentifier(accountId, 'email', pending.email.toLowerCase());
    const deviceId = await this.repo.addDevice({
      accountId,
      platform: pending.platform,
      devicePubkey: Buffer.from(pending.devicePubkeyDer, 'base64'),
      trusted: true,
    });
    await this.repo.audit('user.registered.email', accountId, deviceId);
    await this.events.userCreated(accountId);
    await this.events.deviceAdded(accountId, deviceId, true);
    return this.mintTokens(accountId, deviceId);
  }

  // ── DAPT: approve-on-trusted-device (§B2.5) ──────────────────────────────
  async linkRequest(
    devicePubkeyBase64: string,
    platform: string,
  ): Promise<{ linkId: string; challenge: string }> {
    if (!devicePubkeyBase64 || !platform) {
      throw new ValidationError('devicePubkeyBase64 and platform are required');
    }
    return this.approve.request(devicePubkeyBase64, platform);
  }

  /** A trusted device of the account signs the link challenge → new device provisioned. */
  async linkApprove(
    linkId: string,
    approverDeviceId: string,
    signatureB64: string,
  ): Promise<{ approved: true }> {
    const req = await this.approve.getRequest(linkId);
    const approver = await this.repo.getDevice(approverDeviceId);
    if (!approver) throw new NotFoundError('Approver device not found');
    if (!approver.trusted) throw new UnauthorizedError('Approver device is not trusted');
    this.approve.verifyApproval(req.challenge, approver.pubkey, signatureB64);

    const newDeviceId = await this.repo.addDevice({
      accountId: approver.accountId,
      platform: req.platform,
      devicePubkey: Buffer.from(req.newDevicePubkeyDer, 'base64'),
      trusted: false,
    });
    const tokens = await this.mintTokens(approver.accountId, newDeviceId);
    await this.approve.markApproved(linkId, tokens);
    await this.repo.audit('device.linked', approver.accountId, newDeviceId);
    await this.events.deviceAdded(approver.accountId, newDeviceId, false);
    return { approved: true };
  }

  async linkPoll(linkId: string): Promise<{ status: 'pending' } | Tokens> {
    const result = await this.approve.getResult<Tokens>(linkId);
    return result ?? { status: 'pending' };
  }

  async listDevices(accountId: string): Promise<DeviceRow[]> {
    return this.repo.listDevices(accountId);
  }

  jwks(): { keys: Array<Record<string, unknown>> } {
    return this.tokens.jwks();
  }

  private async accountForDevice(deviceId: string): Promise<string> {
    const accountId = await this.repo.accountForDevice(deviceId);
    if (!accountId) throw new NotFoundError('Device not found');
    return accountId;
  }
}
