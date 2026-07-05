/**
 * Pure helper for mute state (§A4.8). A conversation is muted iff it has a mute-until timestamp in
 * the future. Takes `now` so it's deterministic + unit-testable (used by notification suppression).
 */
export function isMuted(mutedUntil: string | null, now: Date): boolean {
  if (!mutedUntil) return false;
  const t = new Date(mutedUntil).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}

/** Resolve a mute duration keyword to an absolute ISO expiry (null = unmute; 'always' = far future). */
export function muteUntilFrom(duration: '8h' | '1w' | 'always' | 'off', now: Date): string | null {
  switch (duration) {
    case 'off':
      return null;
    case '8h':
      return new Date(now.getTime() + 8 * 3600_000).toISOString();
    case '1w':
      return new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();
    case 'always':
      return new Date('2999-12-31T00:00:00.000Z').toISOString();
  }
}
