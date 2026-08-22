import { decideNotify, inDndWindow } from '../../src/notify/notify-policy';

const AT = (iso: string) => new Date(iso);

describe('decideNotify (§A19/§B10)', () => {
  it('online recipient → in-app, no push', () => {
    expect(decideNotify({ level: 'all' }, { isMention: false, isOnline: true }).notify).toBe(false);
  });

  it('offline + level=all → push', () => {
    const d = decideNotify({ level: 'all' }, { isMention: false, isOnline: false });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe('push');
  });

  it('level=none → never push', () => {
    expect(decideNotify({ level: 'none' }, { isMention: true, isOnline: false }).notify).toBe(
      false,
    );
  });

  it('level=mentions → push only when mentioned', () => {
    expect(decideNotify({ level: 'mentions' }, { isMention: false, isOnline: false }).notify).toBe(
      false,
    );
    expect(decideNotify({ level: 'mentions' }, { isMention: true, isOnline: false }).notify).toBe(
      true,
    );
  });

  it('mute window suppresses; expired mute allows', () => {
    const now = AT('2026-07-04T12:00:00Z');
    expect(
      decideNotify(
        { level: 'all', mutedUntil: AT('2026-07-04T13:00:00Z') },
        { isMention: false, isOnline: false, now },
      ).notify,
    ).toBe(false);
    expect(
      decideNotify(
        { level: 'all', mutedUntil: AT('2026-07-04T11:00:00Z') },
        { isMention: false, isOnline: false, now },
      ).notify,
    ).toBe(true);
  });

  it('DND window suppresses (overnight wrap)', () => {
    const prefs = { level: 'all' as const, dndSchedule: { from: '22:00', to: '07:00' } };
    expect(
      decideNotify(prefs, { isMention: false, isOnline: false, now: AT('2026-07-04T23:30:00Z') })
        .notify,
    ).toBe(false);
    expect(
      decideNotify(prefs, { isMention: false, isOnline: false, now: AT('2026-07-04T12:00:00Z') })
        .notify,
    ).toBe(true);
  });
});

describe('inDndWindow', () => {
  it('same-day window', () => {
    expect(inDndWindow({ from: '09:00', to: '17:00' }, AT('2026-07-04T12:00:00Z'))).toBe(true);
    expect(inDndWindow({ from: '09:00', to: '17:00' }, AT('2026-07-04T18:00:00Z'))).toBe(false);
  });
  it('overnight wrap window', () => {
    expect(inDndWindow({ from: '22:00', to: '07:00' }, AT('2026-07-04T02:00:00Z'))).toBe(true);
    expect(inDndWindow({ from: '22:00', to: '07:00' }, AT('2026-07-04T09:00:00Z'))).toBe(false);
  });
  it('malformed → not in window', () => {
    expect(inDndWindow({ from: 'nope' }, AT('2026-07-04T02:00:00Z'))).toBe(false);
  });
});
