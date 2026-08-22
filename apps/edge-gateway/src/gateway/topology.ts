/**
 * Which runtime service owns each logical service, and therefore which `UPSTREAM_*` variable the
 * proxy resolves.
 *
 * The route table in `routes.ts` is deliberately untouched by the 13 → 6 consolidation: the public
 * API surface does not move, so no client changes. Only the *destination* changes, and it changes
 * here. `SPLIT_PROFILE` selects the mapping, which makes re-splitting (or merging further) a
 * configuration change rather than a refactor:
 *
 *   SPLIT_PROFILE=mono    → everything resolves to UPSTREAM_MONO (one process; fits a 1 GB box)
 *   SPLIT_PROFILE=axis6   → AUTH, USER, GROUP_CHANNEL all resolve to UPSTREAM_IDENTITY   (default)
 *   SPLIT_PROFILE=full13  → each resolves to its own UPSTREAM_AUTH / _USER / _GROUP_CHANNEL
 *
 * `full13` is not decoration; it is the rollback path while both topologies are deployable.
 */
export type SplitProfile = 'mono' | 'axis6' | 'full13';

/** Logical service → runtime service, under the 6-service topology. */
const AXIS6: Record<string, string> = {
  AUTH: 'IDENTITY',
  USER: 'IDENTITY',
  GROUP_CHANNEL: 'IDENTITY',
  CHAT: 'MESSAGING',
  NOTIFICATION: 'MESSAGING',
  SEARCH: 'MESSAGING',
  PRESENCE: 'REALTIME',
  MEDIA: 'CONTENT',
  STATUS: 'CONTENT',
  CALL: 'PLATFORM',
  AUTOMATION: 'PLATFORM',
  AI: 'PLATFORM',
};

/** Default dev port per runtime service, so a local run needs no env at all. */
const DEV_PORTS: Record<string, number> = {
  IDENTITY: 3002,
  MESSAGING: 3004,
  REALTIME: 3006,
  CONTENT: 3008,
  PLATFORM: 3010,
};

export function splitProfile(env: NodeJS.ProcessEnv = process.env): SplitProfile {
  if (env.SPLIT_PROFILE === 'full13') return 'full13';
  if (env.SPLIT_PROFILE === 'mono') return 'mono';
  return 'axis6';
}

/**
 * Resolve the base URL for a logical service. Under `axis6` the logical name is mapped to its
 * runtime owner first; an explicit `UPSTREAM_<LOGICAL>` still wins, so a single service can be
 * peeled out and pointed elsewhere without switching the whole profile.
 */
export function resolveUpstreamFor(
  logical: string,
  devPort: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const direct = env[`UPSTREAM_${logical}`];
  if (direct) return direct;

  const profile = splitProfile(env);
  if (profile === 'mono') {
    return env.UPSTREAM_MONO ?? 'http://localhost:3000';
  }
  if (profile === 'axis6') {
    const runtime = AXIS6[logical];
    if (runtime) {
      return env[`UPSTREAM_${runtime}`] ?? `http://localhost:${DEV_PORTS[runtime] ?? devPort}`;
    }
  }
  return `http://localhost:${devPort}`;
}
