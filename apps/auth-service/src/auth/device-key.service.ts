import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@velchat/shared-utils';

/**
 * Device-key challenge login (§B2.5 — same device, no OTP). The server issues a nonce; the client
 * signs it with the device's private key (held in the secure enclave); the server verifies against
 * the stored device public key. This is the top of the DAPT trust waterfall — the friction-free path.
 * Keys are Ed25519 (SPKI/DER public key stored in `devices.device_pubkey`).
 */
export class DeviceKeyService {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 120,
  ) {}

  async challenge(deviceId: string): Promise<{ nonce: string; expiresIn: number }> {
    const nonce = randomBytes(32).toString('base64url');
    await this.redis.set(`devchal:${deviceId}`, nonce, 'EX', this.ttlSec);
    return { nonce, expiresIn: this.ttlSec };
  }

  /** Verify the device signed the issued nonce. Single-use: the challenge is consumed on success. */
  async verify(deviceId: string, signatureB64: string, devicePubkeyDer: Buffer): Promise<void> {
    const nonce = await this.redis.get(`devchal:${deviceId}`);
    if (!nonce) throw new UnauthorizedError('No active device-key challenge');
    const publicKey = createPublicKey({ key: devicePubkeyDer, format: 'der', type: 'spki' });
    const ok = verify(null, Buffer.from(nonce), publicKey, Buffer.from(signatureB64, 'base64'));
    if (!ok) throw new UnauthorizedError('Device-key signature invalid');
    await this.redis.del(`devchal:${deviceId}`);
  }
}
