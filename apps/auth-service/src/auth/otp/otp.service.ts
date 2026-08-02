import axios from 'axios';
import type { Logger } from 'pino';
import {
  AppError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  RateLimitError,
} from '@velchat/common';
import type { RateLimiter } from '@velchat/cache';

/** Base URL for the 2Factor.in SMS OTP HTTP API. */
const TWO_FACTOR_BASE = 'https://2factor.in/API/V1';

/**
 * The single active OTP session per phone. NOTE (AUTOGEN): 2Factor generates, sends AND stores the
 * OTP on its side — so this record deliberately holds NO code, only the send timestamp used to gate
 * resends. We never store, hash, or log the OTP because we never possess it.
 */
export interface OtpActiveSession {
  phone: string;
  sentAt: number; // epoch ms of the last successful send
}

/** Redis metadata operations backing the OTP rules (see `otp.store.ts`). */
export interface OtpStore {
  putActive(phone: string, session: OtpActiveSession, ttlSec: number): Promise<void>;
  getActive(phone: string): Promise<OtpActiveSession | null>;
  delActive(phone: string): Promise<void>;
  acquireSendMutex(phone: string, ttlSec: number): Promise<boolean>;
  releaseSendMutex(phone: string): Promise<void>;
  incrAttempts(phone: string, ttlSec: number): Promise<number>;
  delAttempts(phone: string): Promise<void>;
  lockVerify(phone: string, ttlSec: number): Promise<void>;
  verifyLockTtl(phone: string): Promise<number>;
}

export interface OtpServiceOptions {
  apiKey?: string;
  template?: string;
  devMode?: boolean;
  devPhone?: string;
  devCode?: string; // fixed code the dev phone verifies against in dev-mode — default '123456'
  otpTtlSec?: number; // OTP lifetime — default 15 min
  resendAfterSec?: number; // min gap between sends — default 2 min
  maxSendsPerWindow?: number; // sends allowed per window — default 3
  sendWindowSec?: number; // send-rate window — default 30 min
  maxVerifyAttempts?: number; // verify attempts before lock — default 5
  lockSec?: number; // verification lock window — default 10 min
  mutexTtlSec?: number; // send() serialisation window — default 15 s
}

/** 2Factor's JSON envelope: `{ Status: 'Success' | 'Error', Details: '...' }`. */
interface TwoFactorResponse {
  Status: string;
  Details: string;
}

/**
 * 2Factor.in SMS OTP — an ADDITIVE auth method alongside Reverse-OTP (§B2). Uses AUTOGEN (2Factor
 * generates + sends + STORES the code) and VERIFY3 (2Factor checks it), so the code never touches
 * our process, DB, or logs — the "never store/log the OTP" requirement is satisfied by design. Only
 * rate-limit / resend / lock / single-active METADATA lives in Redis.
 *
 * Rules (all race-safe via atomic Redis ops): dev-mode fuse (only OTP_DEV_PHONE in dev), one active
 * OTP per phone (a new send invalidates the old), 15-min expiry, resend only after 2 min, ≤3 sends
 * per 30 min, ≤5 verify attempts then a 10-min lock; a SET-NX mutex blocks parallel/duplicate sends.
 */
export class OtpService {
  private readonly apiKey?: string;
  private readonly template: string;
  private readonly devMode: boolean;
  private readonly devPhone?: string;
  private readonly devCode: string;
  private readonly otpTtlSec: number;
  private readonly resendAfterSec: number;
  private readonly maxSendsPerWindow: number;
  private readonly sendWindowSec: number;
  private readonly maxVerifyAttempts: number;
  private readonly lockSec: number;
  private readonly mutexTtlSec: number;

  constructor(
    private readonly store: OtpStore,
    private readonly rateLimiter: RateLimiter,
    private readonly logger: Logger,
    opts: OtpServiceOptions = {},
  ) {
    this.apiKey = opts.apiKey;
    this.template = opts.template ?? 'Temp1';
    this.devMode = opts.devMode ?? true; // fail-closed: default to dev-mode so we never mass-send
    this.devPhone = opts.devPhone;
    this.devCode = opts.devCode ?? '123456';
    this.otpTtlSec = opts.otpTtlSec ?? 15 * 60;
    this.resendAfterSec = opts.resendAfterSec ?? 2 * 60;
    this.maxSendsPerWindow = opts.maxSendsPerWindow ?? 3;
    this.sendWindowSec = opts.sendWindowSec ?? 30 * 60;
    this.maxVerifyAttempts = opts.maxVerifyAttempts ?? 5;
    this.lockSec = opts.lockSec ?? 10 * 60;
    this.mutexTtlSec = opts.mutexTtlSec ?? 15;
  }

  /** Request an OTP (2Factor AUTOGEN). Returns when to allow a resend + the OTP lifetime. */
  async send(
    phoneRaw: string,
  ): Promise<{ message: string; resendAfter: number; expiresIn: number }> {
    const phone = this.requireValidPhone(phoneRaw);
    this.assertDevPhoneAllowed(phone);

    // Dev fast-path: for the configured dev phone in dev-mode, skip the SMS provider AND the
    // resend/send-rate guards entirely — no real SMS is spent and repeated login testing is
    // never throttled. `verify()` accepts the fixed `devCode`. Disabled in prod (devMode=false).
    if (this.isDevPhone(phone)) {
      await this.store.putActive(phone, { phone, sentAt: Date.now() }, this.otpTtlSec);
      await this.store.delAttempts(phone);
      this.logger.info({ phone, action: 'otp.send', status: 'dev' }, 'OTP dev-mode send (no SMS)');
      return { message: 'OTP sent (dev)', resendAfter: 0, expiresIn: this.otpTtlSec };
    }

    const apiKey = this.requireApiKey();

    // Serialise concurrent send() for this phone → blocks parallel/duplicate OTP generation (race-safe).
    if (!(await this.store.acquireSendMutex(phone, this.mutexTtlSec))) {
      throw new ConflictError('An OTP request for this number is already in progress');
    }
    try {
      // Resend guard: one active OTP at a time; a resend is allowed only after `resendAfterSec`.
      const active = await this.store.getActive(phone);
      if (active) {
        const remaining = this.resendAfterSec - Math.floor((Date.now() - active.sentAt) / 1000);
        if (remaining > 0) {
          throw new AppError(
            'OTP_RESEND_TOO_SOON',
            'Please wait before requesting another OTP',
            429,
            {
              resendAfter: remaining,
            },
          );
        }
      }
      // Anti-SMS-bombing: at most `maxSendsPerWindow` sends per `sendWindowSec` (atomic INCR+EXPIRE).
      if (
        !(await this.rateLimiter.allow(
          `otp:send:${phone}`,
          this.maxSendsPerWindow,
          this.sendWindowSec,
        ))
      ) {
        throw new RateLimitError('Too many OTP requests for this number. Try again later.');
      }

      // AUTOGEN — 2Factor creates, sends and stores the code; the response never contains it.
      const resp = await this.call(
        `${TWO_FACTOR_BASE}/${apiKey}/SMS/${encodeURIComponent(phone)}/AUTOGEN/${encodeURIComponent(
          this.template,
        )}`,
      );
      if (resp.Status !== 'Success') {
        this.logger.warn(
          { phone, action: 'otp.send', status: 'rejected' },
          'OTP provider rejected send',
        );
        throw new AppError('OTP_SEND_FAILED', 'Failed to send OTP', 502);
      }

      // A fresh OTP overwrites (invalidates) any previous active one and resets verify attempts.
      await this.store.putActive(phone, { phone, sentAt: Date.now() }, this.otpTtlSec);
      await this.store.delAttempts(phone);

      // Log phone + status only — never the OTP (we don't have it). pino stamps the timestamp.
      this.logger.info({ phone, action: 'otp.send', status: 'sent' }, 'OTP sent');
      return { message: 'OTP sent', resendAfter: this.resendAfterSec, expiresIn: this.otpTtlSec };
    } finally {
      await this.store.releaseSendMutex(phone);
    }
  }

  /** Verify a user-supplied OTP against 2Factor (VERIFY3). We never learn the correct code. */
  async verify(phoneRaw: string, otpRaw: string): Promise<{ verified: true }> {
    const phone = this.requireValidPhone(phoneRaw);
    const otp = typeof otpRaw === 'string' ? otpRaw.trim() : '';
    if (!/^\d{4,8}$/.test(otp)) {
      throw new ValidationError('otp must be a 4–8 digit code');
    }

    // Brute-force lock: reject while a verification lock is active.
    const lockTtl = await this.store.verifyLockTtl(phone);
    if (lockTtl > 0) {
      throw new AppError('OTP_VERIFY_LOCKED', 'Too many invalid attempts. Try again later.', 429, {
        retryAfter: lockTtl,
      });
    }

    // Never verify an expired/absent OTP — absence means the 15-min TTL elapsed or none was sent.
    const active = await this.store.getActive(phone);
    if (!active) {
      throw new UnauthorizedError('OTP expired or not found');
    }

    // Count this attempt atomically BEFORE the upstream call; lock once the cap is exceeded.
    const attempts = await this.store.incrAttempts(phone, this.otpTtlSec);
    if (attempts > this.maxVerifyAttempts) {
      await this.store.lockVerify(phone, this.lockSec);
      await this.store.delActive(phone);
      await this.store.delAttempts(phone);
      this.logger.warn(
        { phone, action: 'otp.verify', status: 'locked' },
        'OTP verification locked',
      );
      throw new AppError('OTP_VERIFY_LOCKED', 'Too many invalid attempts. Try again later.', 429, {
        retryAfter: this.lockSec,
      });
    }

    // Dev phone verifies against the fixed `devCode` (no 2Factor, no SMS); every other
    // number goes to 2Factor VERIFY3. The lock / attempt-count / single-active rules above
    // apply to BOTH paths, so the dev phone still gets brute-force protection.
    let ok: boolean;
    if (this.isDevPhone(phone)) {
      ok = otp === this.devCode;
    } else {
      const apiKey = this.requireApiKey();
      const resp = await this.call(
        `${TWO_FACTOR_BASE}/${apiKey}/SMS/VERIFY3/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}`,
      );
      ok = resp.Status === 'Success';
    }
    if (!ok) {
      this.logger.info(
        { phone, action: 'otp.verify', status: 'invalid' },
        'OTP verification failed',
      );
      throw new UnauthorizedError('Invalid OTP');
    }

    // Success: consume the single-active session + reset counters (replay-proof — no re-verify).
    await this.store.delActive(phone);
    await this.store.delAttempts(phone);
    this.logger.info({ phone, action: 'otp.verify', status: 'verified' }, 'OTP verified');
    return { verified: true };
  }

  /**
   * GET a 2Factor endpoint. `validateStatus` lets 4xx bodies (e.g. an OTP mismatch reported as an
   * `Error` envelope) return normally so the caller can classify them; only network faults / 5xx
   * reject and surface as a clean upstream error.
   */
  private async call(url: string): Promise<TwoFactorResponse> {
    try {
      const res = await axios.get<Partial<TwoFactorResponse>>(url, {
        timeout: 10_000,
        validateStatus: (s) => s < 500,
      });
      const data = res.data ?? {};
      return { Status: String(data.Status ?? ''), Details: String(data.Details ?? '') };
    } catch {
      throw new AppError('OTP_UPSTREAM_ERROR', 'OTP provider is unavailable', 502);
    }
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new AppError('OTP_NOT_CONFIGURED', 'SMS OTP is not configured', 503);
    }
    return this.apiKey;
  }

  private requireValidPhone(raw: string): string {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new ValidationError('phone is required');
    }
    const phone = normalizePhone(raw);
    if (!/^\+[1-9]\d{9,14}$/.test(phone)) {
      throw new ValidationError('phone must be a valid E.164 number');
    }
    return phone;
  }

  /** True for the configured dev phone while dev-mode is on → the OTP fast-path (no SMS, no
   * send rate-limit, fixed `devCode`). Always false in prod (OTP_DEV_MODE='false'). */
  private isDevPhone(phone: string): boolean {
    if (!this.devMode || !this.devPhone) return false;
    return phone === normalizePhone(this.devPhone);
  }

  /** Dev-mode fuse: while on, only OTP_DEV_PHONE may receive an OTP — no SMS spent on other numbers. */
  private assertDevPhoneAllowed(phone: string): void {
    if (!this.devMode) return;
    const allowed = this.devPhone ? normalizePhone(this.devPhone) : '';
    if (!allowed || phone !== allowed) {
      throw new ForbiddenError(
        'OTP dev-mode is on: only the configured dev phone may receive an OTP',
      );
    }
  }
}

/** Normalize to E.164: digits only, forced leading '+'. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}
