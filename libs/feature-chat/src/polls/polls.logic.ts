export interface PollOption {
  id: string;
  text: string;
}

export interface PollDoc {
  _id: string; // message_id the poll is attached to
  conversation_id: string;
  options: PollOption[];
  multi: boolean;
  anonymous: boolean;
  closes_at: string | null; // ISO
  created_by: string;
  created_at: string;
}

export interface PollResults {
  message_id: string;
  options: Array<{ id: string; text: string; count: number; voters?: string[] }>;
  total: number;
  closed: boolean;
  anonymous: boolean;
}

/** A poll is closed if it has a close time in the past. PURE (takes `now`). */
export function isPollClosed(closesAt: string | null, now: Date): boolean {
  if (!closesAt) return false;
  const t = new Date(closesAt).getTime();
  return !Number.isNaN(t) && t <= now.getTime();
}

/**
 * Shape poll results for a viewer (§B16). Counts are always shown; voter lists are included ONLY for
 * non-anonymous polls (or for an admin). PURE — no I/O — so it's fully unit-testable.
 */
export function shapeResults(
  poll: PollDoc,
  countsByOption: Record<string, number>,
  votersByOption: Record<string, string[]>,
  now: Date,
  viewerIsAdmin = false,
): PollResults {
  const showVoters = !poll.anonymous || viewerIsAdmin;
  let total = 0;
  const options = poll.options.map((o) => {
    const count = countsByOption[o.id] ?? 0;
    total += count;
    return showVoters
      ? { id: o.id, text: o.text, count, voters: votersByOption[o.id] ?? [] }
      : { id: o.id, text: o.text, count };
  });
  return {
    message_id: poll._id,
    options,
    total,
    closed: isPollClosed(poll.closes_at, now),
    anonymous: poll.anonymous,
  };
}
