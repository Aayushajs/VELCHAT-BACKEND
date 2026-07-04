/**
 * Retry decision for the durable job runner (§B17). Exponential backoff with a max attempt cap;
 * past the cap the job goes to the DLQ (status=dead). PURE — takes `now`, so it's unit-testable.
 */
export const MAX_JOB_ATTEMPTS = 6;

export function nextRetry(
  attempts: number,
  now: Date,
  maxAttempts = MAX_JOB_ATTEMPTS,
): { dead: boolean; runAt: Date } {
  if (attempts >= maxAttempts) return { dead: true, runAt: now };
  // 2^attempts minutes, capped at 30 min.
  const delayMs = Math.min(2 ** attempts, 30) * 60_000;
  return { dead: false, runAt: new Date(now.getTime() + delayMs) };
}
