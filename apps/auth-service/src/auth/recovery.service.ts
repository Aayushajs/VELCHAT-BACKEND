import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ValidationError, NotFoundError } from '@velchat/shared-utils';

export type RecoveryFactor =
  | 'passkey'
  | 'trusted-device'
  | 'email-link'
  | 'backup-code'
  | 'reverse-otp';

export interface RecoveryRequest {
  recoveryId: string;
  accountId: string;
  factors: RecoveryFactor[];
  createdAt: number;
  delaySec: number;
}

/**
 * Account recovery (§B2.7) — no weak back door. Requires ANY TWO distinct factors AND a cooling-off
 * delay (high-risk → 24h) before completion. Completion revokes all sessions (done by AuthService).
 * SMS/Reverse-OTP is only ONE factor, never alone.
 */
export class RecoveryService {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 72 * 3600,
  ) {}

  private key(id: string): string {
    return `recovery:${id}`;
  }

  async begin(
    accountId: string,
    highRisk = true,
  ): Promise<{ recoveryId: string; delaySec: number }> {
    const recoveryId = randomUUID();
    const delaySec = highRisk ? 24 * 3600 : 0;
    const req: RecoveryRequest = {
      recoveryId,
      accountId,
      factors: [],
      createdAt: Date.now(),
      delaySec,
    };
    await this.redis.set(this.key(recoveryId), JSON.stringify(req), 'EX', this.ttlSec);
    return { recoveryId, delaySec };
  }

  async addFactor(recoveryId: string, factor: RecoveryFactor): Promise<{ factors: number }> {
    const req = await this.get(recoveryId);
    if (!req.factors.includes(factor)) req.factors.push(factor);
    await this.redis.set(this.key(recoveryId), JSON.stringify(req), 'KEEPTTL');
    return { factors: req.factors.length };
  }

  /** §B2.7: need 2+ distinct factors AND the cooling-off delay elapsed. */
  async assertCompletable(recoveryId: string): Promise<RecoveryRequest> {
    const req = await this.get(recoveryId);
    if (req.factors.length < 2) {
      throw new ValidationError(`Recovery needs 2 factors; have ${req.factors.length}`);
    }
    const elapsedSec = (Date.now() - req.createdAt) / 1000;
    if (elapsedSec < req.delaySec) {
      throw new ValidationError(
        `Cooling-off in effect; wait ${Math.ceil(req.delaySec - elapsedSec)}s`,
      );
    }
    return req;
  }

  async consume(recoveryId: string): Promise<void> {
    await this.redis.del(this.key(recoveryId));
  }

  private async get(recoveryId: string): Promise<RecoveryRequest> {
    const raw = await this.redis.get(this.key(recoveryId));
    if (!raw) throw new NotFoundError('Recovery request not found or expired');
    return JSON.parse(raw) as RecoveryRequest;
  }
}
