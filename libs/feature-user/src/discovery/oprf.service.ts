import { ValidationError, RateLimitError, type Logger } from '@velchat/common';
import { RateLimiter } from '@velchat/cache';
import {
  generateOprfKey,
  serializeOprfKey,
  deserializeOprfKey,
  evaluate,
  base64UrlToBigInt,
  bigIntToBase64Url,
  type OprfKeyMaterial,
} from '@velchat/crypto';
import { OprfRepository } from './oprf.repository';

const MAX_BATCH = 2000; // §G2: cap per-request batch size (full-resync throttle)
// Per-account hourly caps on discovery. The original 5/10 were far too tight for real use — a
// couple of New-Chat opens / app restarts (each a batch) tripped a 429. Generous defaults so
// normal use never 429s; env-tunable to clamp back down for production anti-enumeration.
const EVALUATE_LIMIT = Number(process.env.OPRF_EVALUATE_LIMIT) || 500;
const MATCH_LIMIT = Number(process.env.OPRF_MATCH_LIMIT) || 1000;
const WINDOW_SEC = 3600;

export interface PublicOprfKey {
  n: string;
  e: string;
  version: number;
}

/**
 * OPRF-based private contact discovery (§G2). The server NEVER sees a plaintext phone number here:
 * clients blind locally, this service only evaluates blinded values (blind RSA "sign") and later
 * matches opaque tokens the client derived by unblinding. Every evaluate/match call is rate-limited
 * per account, so computing a candidate number's token always costs a live, attributable, throttled
 * round-trip — closing the offline-enumeration hole a plain salted hash leaves open.
 */
export class OprfService {
  constructor(
    private readonly repo: OprfRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly logger: Logger,
  ) {}

  /** Get (or lazily create) the active key, returning only the PUBLIC parameters (n, e). */
  async getPublicKey(): Promise<PublicOprfKey> {
    const active = await this.getOrCreateActiveKeyMaterial();
    return { n: active.record.n, e: active.record.e, version: active.record.version };
  }

  /** Rotate to a fresh key (§G2 "key rotation → republish token set, version it"). Admin-only. */
  async rotateKey(): Promise<PublicOprfKey> {
    const version = (await this.repo.maxVersion()) + 1;
    const key = generateOprfKey(version);
    const serialized = serializeOprfKey(key);
    const row = await this.repo.insertKey(version, serialized.n, serialized.e, serialized.d);
    this.logger.info({ version: row.version }, 'oprf key rotated');
    return { n: row.n, e: row.e, version: row.version };
  }

  /** Server evaluate step: apply the secret exponent to each blinded value. Never sees the number. */
  async evaluateBatch(
    accountId: string,
    blinded: string[],
    keyVersion?: number,
  ): Promise<{ version: number; evaluated: string[] }> {
    if (!accountId) throw new ValidationError('accountId is required');
    if (!Array.isArray(blinded) || blinded.length === 0) {
      throw new ValidationError('blinded must be a non-empty array');
    }
    if (blinded.length > MAX_BATCH) {
      throw new ValidationError(`too many values in one request (max ${MAX_BATCH})`);
    }
    if (!(await this.rateLimiter.allow(`oprf:evaluate:${accountId}`, EVALUATE_LIMIT, WINDOW_SEC))) {
      throw new RateLimitError('Too many discovery lookups — try again later');
    }

    const key = keyVersion
      ? await this.loadKeyMaterial(keyVersion)
      : (await this.getOrCreateActiveKeyMaterial()).key;
    let evaluated: string[];
    try {
      evaluated = blinded.map((b) => bigIntToBase64Url(evaluate(base64UrlToBigInt(b), key)));
    } catch {
      throw new ValidationError('blinded values must be valid base64url big integers');
    }
    return { version: key.version, evaluated };
  }

  /** Opt in to discovery: register a token the client derived (via blind→evaluate→unblind) for itself. */
  async register(
    accountId: string,
    token: string,
    keyVersion: number,
  ): Promise<{ message: string }> {
    if (!accountId || !token) throw new ValidationError('accountId and token are required');
    if (!/^[0-9a-f]{64}$/.test(token))
      throw new ValidationError('token must be a sha256 hex digest');
    await this.repo.registerToken(token, accountId, keyVersion);
    return { message: 'Registered for contact discovery.' };
  }

  /** Opt out of discovery entirely. */
  async unregister(accountId: string): Promise<{ message: string }> {
    await this.repo.removeAccountTokens(accountId);
    return { message: 'Removed from contact discovery.' };
  }

  /** Record the caller's contact tokens as edges (§contact-sync reverse index) so that when any
   * of those numbers later joins VelChat, the owner is notified live. Tokens are opaque OPRF
   * digests — never plaintext numbers. Idempotent; capped + validated like match. */
  async registerEdges(accountId: string, tokens: string[]): Promise<{ message: string }> {
    if (!accountId) throw new ValidationError('accountId is required');
    const unique = [
      ...new Set((tokens ?? []).filter((t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t))),
    ];
    if (unique.length > MAX_BATCH) {
      throw new ValidationError(`too many tokens in one request (max ${MAX_BATCH})`);
    }
    if (unique.length === 0) return { message: 'No edges to register.' };
    await this.repo.upsertEdges(accountId, unique);
    return { message: 'Contact edges registered.' };
  }

  /** Match client-derived tokens (address book, post-unblind) against the discoverable set. */
  async match(accountId: string, tokens: string[]): Promise<{ matches: Record<string, string> }> {
    if (!accountId) throw new ValidationError('accountId is required');
    const unique = [
      ...new Set((tokens ?? []).filter((t) => typeof t === 'string' && t.length > 0)),
    ];
    if (unique.length > MAX_BATCH)
      throw new ValidationError(`too many tokens in one request (max ${MAX_BATCH})`);
    if (!(await this.rateLimiter.allow(`oprf:match:${accountId}`, MATCH_LIMIT, WINDOW_SEC))) {
      throw new RateLimitError('Too many discovery lookups — try again later');
    }
    const rows = await this.repo.matchTokens(unique);
    const matches: Record<string, string> = {};
    for (const r of rows) matches[r.token] = r.account_id;
    return { matches };
  }

  private async getOrCreateActiveKeyMaterial(): Promise<{
    key: OprfKeyMaterial;
    record: { n: string; e: string; version: number };
  }> {
    const row = await this.repo.getActiveKey();
    if (row) {
      const key = deserializeOprfKey({ n: row.n, e: row.e, d: row.d, version: row.version });
      return { key, record: { n: row.n, e: row.e, version: row.version } };
    }
    const key = generateOprfKey(1);
    const serialized = serializeOprfKey(key);
    const inserted = await this.repo.insertKey(1, serialized.n, serialized.e, serialized.d);
    this.logger.info({ version: 1 }, 'oprf key generated (first boot)');
    return { key, record: { n: inserted.n, e: inserted.e, version: inserted.version } };
  }

  private async loadKeyMaterial(version: number): Promise<OprfKeyMaterial> {
    const row = await this.repo.getKeyByVersion(version);
    if (!row) throw new ValidationError(`unknown OPRF key version: ${version}`);
    return deserializeOprfKey({ n: row.n, e: row.e, d: row.d, version: row.version });
  }
}
