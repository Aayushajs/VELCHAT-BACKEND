import type { CampaignRecurrence } from '@velchat/database';

const DAY_MS = 86_400_000;

/**
 * Compute the next run time for a recurring campaign, strictly after `from`, preserving `from`'s
 * time-of-day. Two independent rules (whichever is SOONER wins):
 *  - `everyDays: N`      → from + N days ("har 3 din me ek baar" = 3)
 *  - `daysOfWeek: [..]`  → the next date whose UTC weekday ∈ the set (0=Sun … 6=Sat).
 *                          e.g. [1,4] = "week me 2 baar" (Mon + Thu); [1] = "week me ek baar".
 * PURE: takes `from` as an arg (no Date.now()), so it's fully unit-testable.
 * Returns null if the recurrence has no usable rule.
 */
export function computeNextRun(rec: CampaignRecurrence, from: Date): Date | null {
  const candidates: number[] = [];

  if (typeof rec.everyDays === 'number' && rec.everyDays > 0) {
    candidates.push(from.getTime() + rec.everyDays * DAY_MS);
  }

  const days = (rec.daysOfWeek ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length > 0) {
    for (let i = 1; i <= 7; i++) {
      const cand = new Date(from.getTime() + i * DAY_MS);
      if (days.includes(cand.getUTCDay())) {
        candidates.push(cand.getTime());
        break;
      }
    }
  }

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates));
}

/**
 * Has a recurring campaign finished? True when there is no next run, the next run is past the end
 * date, or the occurrence cap has been reached. PURE (takes `now`).
 */
export function isCampaignComplete(
  c: { occurrences: number; maxOccurrences: number | null; endsAt: Date | null },
  next: Date | null,
  _now: Date,
): boolean {
  if (next === null) return true;
  if (c.endsAt && next.getTime() > c.endsAt.getTime()) return true;
  if (c.maxOccurrences !== null && c.occurrences >= c.maxOccurrences) return true;
  return false;
}
