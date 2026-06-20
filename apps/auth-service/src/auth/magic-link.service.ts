import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@velchat/shared-utils';
import type { MailerPort } from './mailer.port';

/** What we provision once the emailed link is clicked (limited tier — email-only, §B2.4 fallback). */
export interface MagicLinkPending {
  email: string;
  platform: string;
  devicePubkeyDer: string;
}

/** Email magic-link — a free DAPT fallback (self-hosted Postfix). Single-use, short-TTL token. */
export class MagicLinkService {
  constructor(
    private readonly redis: Redis,
    private readonly mailer: MailerPort,
    private readonly baseUrl: string,
    private readonly ttlSec = 900,
  ) {}

  async begin(input: MagicLinkPending): Promise<{ sent: true }> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(`magic:${token}`, JSON.stringify(input), 'EX', this.ttlSec);
    await this.mailer.sendMagicLink(
      input.email,
      `${this.baseUrl}/auth/magic/verify?token=${token}`,
    );
    return { sent: true };
  }

  /** Single-use: the token is consumed on first verify. */
  async consume(token: string): Promise<MagicLinkPending> {
    const raw = await this.redis.get(`magic:${token}`);
    if (!raw) throw new UnauthorizedError('Invalid or expired magic link');
    await this.redis.del(`magic:${token}`);
    return JSON.parse(raw) as MagicLinkPending;
  }
}
