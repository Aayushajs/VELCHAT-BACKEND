import { computeNextRun, isCampaignComplete } from '../../src/campaigns/recurrence';

// A fixed UTC base: 2026-07-06 is a Monday (getUTCDay()===1).
const MON = new Date('2026-07-06T09:00:00.000Z');

describe('computeNextRun', () => {
  it('everyDays: N → from + N days, preserving time-of-day', () => {
    const next = computeNextRun({ everyDays: 3 }, MON);
    expect(next?.toISOString()).toBe('2026-07-09T09:00:00.000Z'); // Thu
  });

  it('daysOfWeek single → next matching weekday after `from`', () => {
    // From Monday, next Monday is 7 days later.
    const next = computeNextRun({ daysOfWeek: [1] }, MON);
    expect(next?.toISOString()).toBe('2026-07-13T09:00:00.000Z');
  });

  it('daysOfWeek multiple ("week me 2 baar", Mon+Thu) → the sooner one', () => {
    // From Monday, next is Thursday (3 days later), not next Monday.
    const next = computeNextRun({ daysOfWeek: [1, 4] }, MON);
    expect(next?.toISOString()).toBe('2026-07-09T09:00:00.000Z'); // Thu
  });

  it('everyDays + daysOfWeek → picks whichever is sooner', () => {
    // everyDays:5 → Sat 11th; daysOfWeek:[4] (Thu) → 9th. Sooner = Thu 9th.
    const next = computeNextRun({ everyDays: 5, daysOfWeek: [4] }, MON);
    expect(next?.toISOString()).toBe('2026-07-09T09:00:00.000Z');
  });

  it('empty / invalid recurrence → null', () => {
    expect(computeNextRun({}, MON)).toBeNull();
    expect(computeNextRun({ everyDays: 0 }, MON)).toBeNull();
    expect(computeNextRun({ daysOfWeek: [] }, MON)).toBeNull();
    expect(computeNextRun({ daysOfWeek: [9, -1] }, MON)).toBeNull();
  });
});

describe('isCampaignComplete', () => {
  const next = new Date('2026-07-09T09:00:00.000Z');

  it('null next → complete', () => {
    expect(
      isCampaignComplete({ occurrences: 1, maxOccurrences: null, endsAt: null }, null, MON),
    ).toBe(true);
  });

  it('next beyond endsAt → complete', () => {
    const endsAt = new Date('2026-07-08T00:00:00.000Z');
    expect(isCampaignComplete({ occurrences: 1, maxOccurrences: null, endsAt }, next, MON)).toBe(
      true,
    );
  });

  it('occurrences reached maxOccurrences → complete', () => {
    expect(isCampaignComplete({ occurrences: 5, maxOccurrences: 5, endsAt: null }, next, MON)).toBe(
      true,
    );
  });

  it('still within limits → not complete', () => {
    const endsAt = new Date('2026-08-01T00:00:00.000Z');
    expect(isCampaignComplete({ occurrences: 2, maxOccurrences: 10, endsAt }, next, MON)).toBe(
      false,
    );
  });
});
