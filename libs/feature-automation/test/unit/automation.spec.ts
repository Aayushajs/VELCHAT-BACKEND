import { signPayload, verifySignature } from '../../src/automation/hmac';
import { nextRetry, MAX_JOB_ATTEMPTS } from '../../src/automation/backoff';

describe('hmac (§B17 webhook signing)', () => {
  it('signs deterministically + verifies its own signature', () => {
    const sig = signPayload('secret', '{"a":1}');
    expect(sig).toBe(signPayload('secret', '{"a":1}'));
    expect(sig).toHaveLength(64); // sha256 hex
    expect(verifySignature('secret', '{"a":1}', sig)).toBe(true);
  });

  it('rejects a wrong secret / tampered body / bad signature', () => {
    const sig = signPayload('secret', '{"a":1}');
    expect(verifySignature('other', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('secret', '{"a":2}', sig)).toBe(false);
    expect(verifySignature('secret', '{"a":1}', 'deadbeef')).toBe(false);
  });
});

describe('backoff (durable job retry)', () => {
  const now = new Date('2026-07-04T12:00:00.000Z');

  it('schedules an exponentially later retry while under the cap', () => {
    const r0 = nextRetry(0, now);
    const r2 = nextRetry(2, now);
    expect(r0.dead).toBe(false);
    expect(r2.dead).toBe(false);
    expect(r2.runAt.getTime()).toBeGreaterThan(r0.runAt.getTime());
  });

  it('caps the delay at 30 minutes', () => {
    const r = nextRetry(20, now, 999); // huge attempt but not dead (high cap)
    expect(r.runAt.getTime() - now.getTime()).toBe(30 * 60_000);
  });

  it('marks dead once attempts reach the max', () => {
    expect(nextRetry(MAX_JOB_ATTEMPTS, now).dead).toBe(true);
    expect(nextRetry(MAX_JOB_ATTEMPTS - 1, now).dead).toBe(false);
  });
});
