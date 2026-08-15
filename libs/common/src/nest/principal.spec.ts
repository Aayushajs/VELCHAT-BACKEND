import { ForbiddenError, UnauthorizedError } from '../errors/errors';
import { actingAccountId } from './principal';

/**
 * The rule these tests pin down (§D4, "never trust client-provided userId/senderId"): the acting
 * identity is ALWAYS the verified JWT subject. A body-supplied id is tolerated for backwards
 * compatibility — the mobile client still sends `senderId`, and the global ValidationPipe runs with
 * `forbidNonWhitelisted`, so the field cannot simply be dropped — but it never *decides* anything.
 */
describe('actingAccountId', () => {
  it('uses the verified subject when the body claims nothing', () => {
    expect(actingAccountId('acc-1')).toBe('acc-1');
    expect(actingAccountId('acc-1', undefined)).toBe('acc-1');
    expect(actingAccountId('acc-1', null)).toBe('acc-1');
    expect(actingAccountId('acc-1', '')).toBe('acc-1');
  });

  it('uses the verified subject when the body claims the same id', () => {
    expect(actingAccountId('acc-1', 'acc-1')).toBe('acc-1');
  });

  it('refuses a body-supplied id that differs from the verified subject', () => {
    expect(() => actingAccountId('acc-1', 'acc-victim')).toThrow(ForbiddenError);
  });

  it('refuses when there is no verified subject at all', () => {
    // Reaching here with an empty subject means the guard was skipped or misconfigured. Failing
    // closed matters more than the specific status: never fall through to the claimed id.
    expect(() => actingAccountId('', 'acc-1')).toThrow(UnauthorizedError);
    expect(() => actingAccountId(undefined as unknown as string)).toThrow(UnauthorizedError);
  });

  it('does not leak either id in the error message', () => {
    // Echoing the spoof target would give an attacker a probe for valid account ids.
    expect.assertions(3);
    try {
      actingAccountId('acc-1', 'acc-victim');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as Error).message).not.toContain('acc-victim');
      expect((err as Error).message).not.toContain('acc-1');
    }
  });
});
