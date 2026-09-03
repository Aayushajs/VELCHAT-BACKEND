import { canView, type Audience } from '../../src/status/status.types';

const CONTACT = { isContact: true, isBlocked: false };
const STRANGER = { isContact: false, isBlocked: false };
const BLOCKED_CONTACT = { isContact: true, isBlocked: true };

describe('canView — the single authorization decision for a status', () => {
  it('lets the author see their own status regardless of rule or relationship', () => {
    const a: Audience = { mode: 'only', list: ['someone-else'] };
    expect(canView({ audience: a, authorId: 'author' }, 'author', BLOCKED_CONTACT)).toBe(true);
  });

  describe('mode: contacts', () => {
    const audience: Audience = { mode: 'contacts' };
    it('allows a contact', () => {
      expect(canView({ audience, authorId: 'a' }, 'v', CONTACT)).toBe(true);
    });
    it('denies a non-contact', () => {
      expect(canView({ audience, authorId: 'a' }, 'v', STRANGER)).toBe(false);
    });
  });

  describe('mode: except', () => {
    const audience: Audience = { mode: 'except', list: ['bob'] };
    it('allows a contact not on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'alice', CONTACT)).toBe(true);
    });
    it('denies a contact on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'bob', CONTACT)).toBe(false);
    });
    it('denies a non-contact even when not on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', STRANGER)).toBe(false);
    });
  });

  describe('mode: only', () => {
    const audience: Audience = { mode: 'only', list: ['carol'] };
    it('allows a listed viewer', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', CONTACT)).toBe(true);
    });
    it('allows a listed viewer who is not a contact (the list is explicit intent)', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', STRANGER)).toBe(true);
    });
    it('denies an unlisted viewer', () => {
      expect(canView({ audience, authorId: 'a' }, 'alice', CONTACT)).toBe(false);
    });
  });

  // A block overrides every mode, including an explicit `only` list — being named earlier does not
  // survive being blocked later.
  it.each(['contacts', 'except', 'only'] as const)('denies a blocked viewer under %s', (mode) => {
    const audience: Audience = { mode, list: ['v'] };
    expect(canView({ audience, authorId: 'a' }, 'v', BLOCKED_CONTACT)).toBe(false);
  });

  // Existing rows written before this change carry a materialised contact snapshot in
  // audience.list. Under `contacts` mode that list is ignored in favour of the live relationship,
  // which is strictly more correct — a removed contact loses access immediately.
  it('ignores a legacy materialised list under contacts mode', () => {
    const legacy: Audience = { mode: 'contacts', list: ['stale-follower'] };
    expect(canView({ audience: legacy, authorId: 'a' }, 'stale-follower', STRANGER)).toBe(false);
  });
});
