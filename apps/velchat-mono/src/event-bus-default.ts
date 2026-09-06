/**
 * Which event bus a single-process build should use when nothing says otherwise.
 *
 * `mono` runs every feature group in ONE process, so every event it publishes is consumed by
 * itself. The platform default is `redis-streams` — correct for a split deployment, and a poor
 * trade here: the process sends each event out to Redis and reads it back through a consumer
 * group, so talking to itself depends on stream creation, group creation and an XREADGROUP loop
 * staying healthy.
 *
 * The failure mode that matters is silent and total. Fan-out is what turns a stored message into
 * a socket frame, and membership is seeded by a fan-out subscription too — so if delivery stops,
 * messages are still written and still acknowledged over REST, ticks never advance, and realtime
 * simply does not happen. Every health check stays green, because nothing is unhealthy: the
 * events just never arrive.
 *
 * Correct by default, not by runbook: deploying a single-process build should not require an
 * operator to know any of this. An explicit `EVENT_BUS` is always honoured, so a deliberate
 * split deployment (or a debugging session) still gets exactly what it asked for.
 */
export function monoEventBusDefault(env: { EVENT_BUS?: string | undefined }): string {
  const explicit = env.EVENT_BUS?.trim();
  return explicit ? explicit : 'memory';
}
