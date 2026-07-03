import type { NotifyLevel } from '@velchat/database';

export interface NotifyPrefs {
  level: NotifyLevel;
  mutedUntil?: Date | null;
  dndSchedule?: { tz?: string; from?: string; to?: string } | null;
}

export interface NotifyContext {
  /** Was this user @-mentioned in the message? */
  isMention: boolean;
  /** Is the user currently online on any device (→ in-app delivery, skip push)? */
  isOnline: boolean;
  now?: Date;
}

export interface NotifyDecision {
  notify: boolean;
  reason: string;
}

/**
 * Pure push-eligibility policy (§A19 / §B10). Order matters: online users get in-app delivery (no
 * push); then level (all/mentions/none), explicit mute window, and DND schedule gate it. Kept pure
 * + side-effect-free so it's exhaustively unit-testable — the heart of "don't notify wrongly".
 */
export function decideNotify(prefs: NotifyPrefs, ctx: NotifyContext): NotifyDecision {
  const now = ctx.now ?? new Date();
  if (ctx.isOnline) return { notify: false, reason: 'recipient online → in-app, no push' };
  if (prefs.level === 'none') return { notify: false, reason: 'level=none (muted)' };
  if (prefs.level === 'mentions' && !ctx.isMention) {
    return { notify: false, reason: 'level=mentions and not mentioned' };
  }
  if (prefs.mutedUntil && now < prefs.mutedUntil) {
    return { notify: false, reason: 'mute window active' };
  }
  if (prefs.dndSchedule && inDndWindow(prefs.dndSchedule, now)) {
    return { notify: false, reason: 'do-not-disturb window' };
  }
  return { notify: true, reason: 'push' };
}

/** Is `now` within [from, to) (HH:MM, UTC MVP — tz-aware refinement later)? Handles overnight wrap. */
export function inDndWindow(schedule: { from?: string; to?: string }, now: Date): boolean {
  const from = toMinutes(schedule.from);
  const to = toMinutes(schedule.to);
  if (from === null || to === null) return false;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to; // wrap past midnight
}

function toMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
