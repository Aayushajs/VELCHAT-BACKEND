import axios from 'axios';
import type { Logger } from 'pino';
import { RateLimiter } from '@velchat/cache';
import { OtpService } from './otp.service';
import { RedisOtpStore } from './otp.store';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const OK = { data: { Status: 'Success', Details: 'ok' } };
const ERR = { data: { Status: 'Error', Details: 'OTP Mismatch' } };

const DEV_PHONE = '+919302633266';
const PHONE = '+15551234567';

/**
 * Time-aware in-memory Valkey fake: honours SET/GET/DEL, SET…EX (expiry), SET…NX (mutex), INCR,
 * EXPIRE and TTL against the (fake) system clock, so 15-min expiry / 2-min resend / 10-min lock are
 * exercised for real by advancing `jest.setSystemTime`.
 */
function fakeRedis() {
  const store = new Map<string, { value: string; expireAt: number | null }>();
  const alive = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expireAt !== null && Date.now() >= e.expireAt) {
      store.delete(k);
      return null;
    }
    return e;
  };
  return {
    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes('NX') && alive(key)) return null;
      let expireAt: number | null = null;
      const exIdx = args.indexOf('EX');
      if (exIdx >= 0) expireAt = Date.now() + Number(args[exIdx + 1]) * 1000;
      store.set(key, { value, expireAt });
      return 'OK';
    },
    async get(key: string) {
      return alive(key)?.value ?? null;
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async incr(key: string) {
      const e = alive(key);
      const next = (e ? Number(e.value) : 0) + 1;
      store.set(key, { value: String(next), expireAt: e?.expireAt ?? null });
      return next;
    },
    async expire(key: string, secs: number) {
      const e = alive(key);
      if (!e) return 0;
      e.expireAt = Date.now() + secs * 1000;
      return 1;
    },
    async ttl(key: string) {
      const e = alive(key);
      if (!e) return -2;
      return e.expireAt === null ? -1 : Math.ceil((e.expireAt - Date.now()) / 1000);
    },
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const redis = fakeRedis();
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const svc = new OtpService(
    new RedisOtpStore(redis as never),
    new RateLimiter(redis as never),
    logger,
    {
      apiKey: 'test-key',
      template: 'Temp1',
      devMode: false,
      devPhone: DEV_PHONE,
      ...overrides,
    },
  );
  return { svc, redis };
}

const BASE = Date.UTC(2026, 6, 19, 12, 0, 0);

describe('OtpService (2Factor.in SMS OTP)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE);
    mockedAxios.get.mockResolvedValue(OK as never);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('send returns resendAfter + expiresIn and calls 2Factor AUTOGEN', async () => {
    const { svc } = makeService();
    const res = await svc.send(PHONE);
    expect(res).toEqual({ message: 'OTP sent', resendAfter: 120, expiresIn: 900 });
    const url = mockedAxios.get.mock.calls[0]?.[0] as string;
    expect(url).toContain('/SMS/');
    expect(url).toContain('/AUTOGEN/Temp1');
    expect(url).not.toContain('undefined');
  });

  it('never logs or transmits an OTP on send (AUTOGEN — we never possess it)', async () => {
    const { svc } = makeService();
    await svc.send(PHONE);
    const url = mockedAxios.get.mock.calls[0]?.[0] as string;
    // AUTOGEN URL carries no OTP; verification is the only place a code appears, supplied by the user.
    expect(url).toContain('/AUTOGEN/');
  });

  it('verify succeeds against 2Factor VERIFY3 and consumes the single-active OTP', async () => {
    const { svc } = makeService();
    await svc.send(PHONE);
    const res = await svc.verify(PHONE, '123456');
    expect(res).toEqual({ verified: true });
    const verifyUrl = mockedAxios.get.mock.calls[1]?.[0] as string;
    expect(verifyUrl).toContain('/SMS/VERIFY3/');
    // Session consumed → a replay verify now fails as expired/absent.
    await expect(svc.verify(PHONE, '123456')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('verify rejects a wrong OTP (2Factor Status=Error) with 401', async () => {
    const { svc } = makeService();
    mockedAxios.get.mockResolvedValueOnce(OK as never).mockResolvedValueOnce(ERR as never);
    await svc.send(PHONE);
    await expect(svc.verify(PHONE, '000000')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      httpStatus: 401,
    });
  });

  it('verify rejects an expired OTP after 15 minutes', async () => {
    const { svc } = makeService();
    await svc.send(PHONE);
    jest.setSystemTime(BASE + 15 * 60 * 1000 + 1000); // 15 min + 1s later
    await expect(svc.verify(PHONE, '123456')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'OTP expired or not found',
    });
  });

  it('verify rejects when there is no active OTP', async () => {
    const { svc } = makeService();
    await expect(svc.verify(PHONE, '123456')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('blocks a resend before 2 minutes and returns remaining seconds', async () => {
    const { svc } = makeService();
    await svc.send(PHONE);
    jest.setSystemTime(BASE + 60 * 1000); // 60s later
    await expect(svc.send(PHONE)).rejects.toMatchObject({
      code: 'OTP_RESEND_TOO_SOON',
      httpStatus: 429,
      details: { resendAfter: 60 },
    });
  });

  it('allows a resend after 2 minutes', async () => {
    const { svc } = makeService();
    await svc.send(PHONE);
    jest.setSystemTime(BASE + 121 * 1000); // 2 min + 1s later
    const res = await svc.send(PHONE);
    expect(res.message).toBe('OTP sent');
  });

  it('enforces at most 3 sends per 30 minutes', async () => {
    const { svc } = makeService();
    await svc.send(PHONE); // #1
    jest.setSystemTime(BASE + 121 * 1000);
    await svc.send(PHONE); // #2
    jest.setSystemTime(BASE + 242 * 1000);
    await svc.send(PHONE); // #3
    jest.setSystemTime(BASE + 363 * 1000);
    await expect(svc.send(PHONE)).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
  });

  it('locks verification for 10 minutes after 5 failed attempts', async () => {
    const { svc } = makeService();
    mockedAxios.get.mockResolvedValue(ERR as never); // every VERIFY3 fails
    // Seed the active session directly (send would need a Success), then exhaust attempts.
    mockedAxios.get.mockResolvedValueOnce(OK as never); // the send
    await svc.send(PHONE);
    for (let i = 0; i < 5; i += 1) {
      await expect(svc.verify(PHONE, '000000')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }
    // 6th attempt trips the lock…
    await expect(svc.verify(PHONE, '000000')).rejects.toMatchObject({ code: 'OTP_VERIFY_LOCKED' });
    // …and stays locked for subsequent attempts.
    await expect(svc.verify(PHONE, '000000')).rejects.toMatchObject({
      code: 'OTP_VERIFY_LOCKED',
      httpStatus: 429,
    });
  });

  it('blocks a parallel/duplicate send while one is in progress (SET-NX mutex)', async () => {
    const { svc, redis } = makeService();
    await redis.set(`otp:mutex:${PHONE}`, '1', 'EX', 15, 'NX'); // simulate an in-flight send
    await expect(svc.send(PHONE)).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
  });

  it('dev-mode allows only the configured dev phone (via the no-SMS fast-path)', async () => {
    const { svc } = makeService({ devMode: true });
    const res = await svc.send(DEV_PHONE);
    expect(res.message).toBe('OTP sent (dev)');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('dev-mode rejects any other phone with 403 (no SMS spent)', async () => {
    const { svc } = makeService({ devMode: true });
    await expect(svc.send(PHONE)).rejects.toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('prod-mode allows any valid phone', async () => {
    const { svc } = makeService({ devMode: false });
    const res = await svc.send('+441234567890');
    expect(res.message).toBe('OTP sent');
  });

  it('rejects an invalid phone number with 400', async () => {
    const { svc } = makeService();
    await expect(svc.send('12345')).rejects.toMatchObject({ code: 'VALIDATION', httpStatus: 400 });
  });

  it('returns a clean error when OTP_API_KEY is not configured', async () => {
    const { svc } = makeService({ apiKey: undefined });
    await expect(svc.send(PHONE)).rejects.toMatchObject({ code: 'OTP_NOT_CONFIGURED' });
  });

  // ── dev fast-path (OTP_DEV_MODE=true, dev phone): no SMS, no rate-limit, fixed code ──
  it('dev phone: send skips 2Factor + send rate-limits and verifies with the fixed devCode', async () => {
    const { svc } = makeService({
      devMode: true,
      devPhone: DEV_PHONE,
      devCode: '000111',
      apiKey: undefined, // dev path must work even without an SMS key
    });
    const res = await svc.send(DEV_PHONE);
    expect(res).toEqual({ message: 'OTP sent (dev)', resendAfter: 0, expiresIn: 900 });
    // Rapid resends are NOT throttled for the dev phone, and no SMS provider is ever hit.
    await svc.send(DEV_PHONE);
    await svc.send(DEV_PHONE);
    await svc.send(DEV_PHONE);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    const v = await svc.verify(DEV_PHONE, '000111');
    expect(v).toEqual({ verified: true });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('dev phone: verify rejects a wrong code with 401 and never calls 2Factor', async () => {
    const { svc } = makeService({ devMode: true, devPhone: DEV_PHONE, devCode: '000111' });
    await svc.send(DEV_PHONE);
    await expect(svc.verify(DEV_PHONE, '999999')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      httpStatus: 401,
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('dev-mode fuse still blocks any NON-dev number (no fast-path leak, no SMS)', async () => {
    const { svc } = makeService({ devMode: true, devPhone: DEV_PHONE });
    await expect(svc.send(PHONE)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
