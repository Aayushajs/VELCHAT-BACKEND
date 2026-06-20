import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@velchat/shared-utils';

export interface PasskeyRp {
  rpID: string;
  rpName: string;
  origin: string;
}

export interface StoredCredential {
  credId: string; // base64url
  publicKey: Buffer;
  counter: number;
}

/**
 * Passkey / WebAuthn (§B2.5) — phishing-proof, origin-bound credentials via @simplewebauthn/server.
 * Challenges are single-use in Valkey. The browser ceremony (navigator.credentials) runs client-side;
 * here we generate options and verify the attestation/assertion. NOTE: the @simplewebauthn input
 * shapes are version-specific JSON from the browser, so call args are passed through opaquely.
 */
export class PasskeyService {
  constructor(
    private readonly rp: PasskeyRp,
    private readonly redis: Redis,
    private readonly ttlSec = 300,
  ) {}

  private async putChallenge(key: string, challenge: string): Promise<void> {
    await this.redis.set(`pk:${key}`, challenge, 'EX', this.ttlSec);
  }

  private async takeChallenge(key: string): Promise<string | null> {
    const value = await this.redis.get(`pk:${key}`);
    if (value) await this.redis.del(`pk:${key}`);
    return value;
  }

  async registrationOptions(accountId: string, userName: string): Promise<{ challenge: string }> {
    const options = await generateRegistrationOptions({
      rpName: this.rp.rpName,
      rpID: this.rp.rpID,
      userName,
      userID: Buffer.from(accountId),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    } as never);
    await this.putChallenge(`reg:${accountId}`, options.challenge);
    return options;
  }

  async verifyRegistration(accountId: string, response: unknown): Promise<StoredCredential> {
    const expectedChallenge = await this.takeChallenge(`reg:${accountId}`);
    if (!expectedChallenge) throw new UnauthorizedError('No passkey registration challenge');
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.rp.origin,
      expectedRPID: this.rp.rpID,
    } as never);
    const info = verification.registrationInfo as unknown as {
      credential?: { id: string; publicKey: Uint8Array; counter: number };
      credentialID?: Uint8Array;
      credentialPublicKey?: Uint8Array;
      counter?: number;
    } | null;
    if (!verification.verified || !info) {
      throw new UnauthorizedError('Passkey registration failed verification');
    }
    const credId = info.credential?.id ?? toB64url(info.credentialID);
    const publicKey = info.credential?.publicKey ?? info.credentialPublicKey;
    const counter = info.credential?.counter ?? info.counter ?? 0;
    if (!credId || !publicKey)
      throw new UnauthorizedError('Passkey registration missing credential');
    return { credId, publicKey: Buffer.from(publicKey), counter };
  }

  async authenticationOptions(
    accountId: string,
    allowCredIds: string[],
  ): Promise<{ challenge: string }> {
    const options = await generateAuthenticationOptions({
      rpID: this.rp.rpID,
      allowCredentials: allowCredIds.map((id) => ({ id })),
    } as never);
    await this.putChallenge(`auth:${accountId}`, options.challenge);
    return options;
  }

  async verifyAuthentication(
    accountId: string,
    response: unknown,
    cred: StoredCredential,
  ): Promise<number> {
    const expectedChallenge = await this.takeChallenge(`auth:${accountId}`);
    if (!expectedChallenge) throw new UnauthorizedError('No passkey authentication challenge');
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.rp.origin,
      expectedRPID: this.rp.rpID,
      credential: {
        id: cred.credId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
      },
    } as never);
    if (!verification.verified) throw new UnauthorizedError('Passkey authentication failed');
    return verification.authenticationInfo.newCounter;
  }
}

function toB64url(bytes?: Uint8Array): string | undefined {
  return bytes ? Buffer.from(bytes).toString('base64url') : undefined;
}
