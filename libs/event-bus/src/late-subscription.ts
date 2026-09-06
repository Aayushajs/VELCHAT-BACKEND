/**
 * Which subscriptions still have no reader.
 *
 * A bus that refuses to do anything on a second `start()` silently strands every consumer wired
 * after the first one — and in the single-process build the realtime fan-out consumer is
 * necessarily wired late, because it needs the HTTP server, which does not exist until the
 * application has been created. Those events then have no reader at all: published, consumed by
 * nobody, with nothing anywhere to indicate it.
 *
 * Kept as a pure function so the rule is testable without Redis.
 */
export interface TopicSubscription {
  readonly topic: string;
  readonly groupId: string;
}

export interface StartedGroup {
  readonly groupId: string;
  readonly topics: readonly string[];
}

/** Subscriptions not covered by an already-running reader, de-duplicated. */
export function pendingSubscriptions(
  all: readonly TopicSubscription[],
  started: readonly StartedGroup[],
): TopicSubscription[] {
  // A consumer group reads independently of every other, so coverage is per (group, topic).
  const covered = new Set<string>();
  for (const g of started) {
    for (const t of g.topics) covered.add(`${g.groupId} ${t}`);
  }
  const seen = new Set<string>();
  const pending: TopicSubscription[] = [];
  for (const s of all) {
    const key = `${s.groupId} ${s.topic}`;
    if (covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    pending.push(s);
  }
  return pending;
}
