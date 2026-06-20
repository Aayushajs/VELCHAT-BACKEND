import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UnauthorizedError, NotFoundError } from '@velchat/shared-utils';

export interface LinkRequest {
  newDevicePubkeyDer: string;
  platform: string;
  challenge: string;
}

/**
 * Approve-on-trusted-device (§B2.5). A new device requests a link (QR = {linkId, challenge}); an
 * already-trusted device of the account signs the challenge with its device key; the server
 * verifies and provisions the new device under the SAME account. No OTP, no plaintext over the wire.
 */
export class ApproveDeviceService {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 300,
  ) {}

  async request(
    newDevicePubkeyDer: string,
    platform: string,
  ): Promise<{ linkId: string; challenge: string }> {
    const linkId = randomBytes(16).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(
      `devlink:${linkId}`,
      JSON.stringify({ newDevicePubkeyDer, platform, challenge }),
      'EX',
      this.ttlSec,
    );
    return { linkId, challenge };
  }

  async getRequest(linkId: string): Promise<LinkRequest> {
    const raw = await this.redis.get(`devlink:${linkId}`);
    if (!raw) throw new NotFoundError('Link request not found or expired');
    return JSON.parse(raw) as LinkRequest;
  }

  /** Verify the trusted device signed the link challenge. */
  verifyApproval(challenge: string, approverPubkeyDer: Buffer, signatureB64: string): void {
    const key = createPublicKey({ key: approverPubkeyDer, format: 'der', type: 'spki' });
    const ok = verify(null, Buffer.from(challenge), key, Buffer.from(signatureB64, 'base64'));
    if (!ok) throw new UnauthorizedError('Approver device-key signature invalid');
  }

  async markApproved(linkId: string, result: unknown): Promise<void> {
    await this.redis.set(`devlink:result:${linkId}`, JSON.stringify(result), 'EX', 120);
    await this.redis.del(`devlink:${linkId}`);
  }

  async getResult<T>(linkId: string): Promise<T | null> {
    const raw = await this.redis.get(`devlink:result:${linkId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }
}
