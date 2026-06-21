import { createHash } from 'node:crypto';

/**
 * Deterministic DM conversation id from the sorted member pair (§B7) — same two users always map
 * to the same conversation, so a DM is created at most once (dedupe).
 */
export function dmConversationId(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return 'dm-' + createHash('sha256').update(`${x}|${y}`).digest('hex').slice(0, 32);
}
