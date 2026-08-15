import { decideResend, isTerminal, MAX_RESEND_ATTEMPTS } from '../../src/resend/resend.logic';

describe('resend protocol logic (§G1-1)', () => {
  it('allows a resend while under the attempt cap', () => {
    expect(decideResend(0)).toEqual({ allowed: true, status: 'requested' });
    expect(decideResend(MAX_RESEND_ATTEMPTS - 1)).toEqual({ allowed: true, status: 'requested' });
  });

  it('exhausts once the attempt cap is reached (→ unrecoverable, not silent loss)', () => {
    expect(decideResend(MAX_RESEND_ATTEMPTS)).toEqual({ allowed: false, status: 'exhausted' });
    expect(decideResend(MAX_RESEND_ATTEMPTS + 3)).toEqual({ allowed: false, status: 'exhausted' });
  });

  it('respects a custom cap', () => {
    expect(decideResend(2, 2)).toEqual({ allowed: false, status: 'exhausted' });
    expect(decideResend(1, 2)).toEqual({ allowed: true, status: 'requested' });
  });

  it('terminal states are fulfilled + exhausted; requested is not', () => {
    expect(isTerminal('fulfilled')).toBe(true);
    expect(isTerminal('exhausted')).toBe(true);
    expect(isTerminal('requested')).toBe(false);
  });
});
