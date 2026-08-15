import type { Redis } from 'ioredis';
import type { OtpActiveSession, OtpStore } from './otp.service';

/**
 * Valkey-backed OTP metadata store (mirrors `reverse-otp.store.ts`). 2Factor.in owns the OTP code
 * itself (AUTOGEN), so NOTHING here is ever the OTP — we only persist rate-limit / resend / lock /
 * single-active-session METADATA, keyed per normalized phone:
 *   otp:active:{phone}   one active OTP session (value = sentAt); presence+TTL = the 15-min lifetime
 *   otp:mutex:{phone}    short SET-NX mutex serialising send() to block parallel/duplicate generation
 *   otp:attempts:{phone} atomic INCR verification-attempt counter (EXPIRE tied to the OTP lifetime)
 *   otp:lock:{phone}     verification lock after too many invalid attempts (TTL = lock window)
 */
export class RedisOtpStore implements OtpStore {
  constructor(private readonly redis: Redis) {}

  /** Overwrite the single active session (a new OTP invalidates the previous one). */
  async putActive(phone: string, session: OtpActiveSession, ttlSec: number): Promise<void> {
    await this.redis.set(`otp:active:${phone}`, JSON.stringify(session), 'EX', ttlSec);
  }

  async getActive(phone: string): Promise<OtpActiveSession | null> {
    const raw = await this.redis.get(`otp:active:${phone}`);
    return raw ? (JSON.parse(raw) as OtpActiveSession) : null;
  }

  async delActive(phone: string): Promise<void> {
    await this.redis.del(`otp:active:${phone}`);
  }

  /** SET NX mutex — true only if we acquired it. Serialises concurrent send() calls (anti-race). */
  async acquireSendMutex(phone: string, ttlSec: number): Promise<boolean> {
    const res = await this.redis.set(`otp:mutex:${phone}`, '1', 'EX', ttlSec, 'NX');
    return res === 'OK';
  }

  async releaseSendMutex(phone: string): Promise<void> {
    await this.redis.del(`otp:mutex:${phone}`);
  }

  /** Atomic INCR (+ EXPIRE on first) verification-attempt counter — no read-then-write race. */
  async incrAttempts(phone: string, ttlSec: number): Promise<number> {
    const count = await this.redis.incr(`otp:attempts:${phone}`);
    if (count === 1) await this.redis.expire(`otp:attempts:${phone}`, ttlSec);
    return count;
  }

  async delAttempts(phone: string): Promise<void> {
    await this.redis.del(`otp:attempts:${phone}`);
  }

  async lockVerify(phone: string, ttlSec: number): Promise<void> {
    await this.redis.set(`otp:lock:${phone}`, '1', 'EX', ttlSec);
  }

  /** Remaining lock seconds (> 0 while locked), or 0 when not locked. */
  async verifyLockTtl(phone: string): Promise<number> {
    const ttl = await this.redis.ttl(`otp:lock:${phone}`);
    return ttl > 0 ? ttl : 0;
  }
}
