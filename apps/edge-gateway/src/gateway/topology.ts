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

/**
 * Runtime service → its deployed service slug. Used ONLY to recover a sibling's host when the
 * blueprint's `UPSTREAM_*` never made it onto the instance (see {@link deriveSiblingHost}).
 */
const RENDER_SLUGS: Record<string, string> = {
  IDENTITY: 'identity-service',
  MESSAGING: 'messaging-service',
  REALTIME: 'realtime-service',
  CONTENT: 'content-service',
  PLATFORM: 'platform-service',
};

/**
 * Recover a sibling service's host from our own.
 *
 * Render names siblings identically except for the service slug — `velchat-edge-gateway-2aje`
 * and `velchat-identity-service-2aje` share the deployment suffix — so our own external hostname
 * already contains everything needed. This is a LAST RESORT behind `UPSTREAM_*`: without it, a
 * gateway whose blueprint env never landed falls back to `http://localhost:<devPort>`, which in a
 * managed container is itself. Every proxied request then 502s instantly while each upstream is
 * healthy on its own URL — and the gateway's own /health still reports "ok", which makes it look
 * like a client bug. Returns null when the host doesn't match the expected shape; guessing wildly
 * would be worse than failing honestly.
 */
function deriveSiblingHost(runtime: string, env: NodeJS.ProcessEnv): string | null {
  const self = env.RENDER_EXTERNAL_HOSTNAME?.trim();
  const slug = RENDER_SLUGS[runtime];
  if (!self || !slug || !self.includes('edge-gateway')) return null;
  return self.replace('edge-gateway', slug);
}

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
/**
 * Accept a bare hostname as well as a full URL.
 *
 * Render's blueprint can only inject a service's *host* (`fromService … property: host`), with no
 * scheme — and a hardcoded `https://…onrender.com` is not an option because Render appends a
 * random suffix when a service name is taken. A scheme-less value is therefore the normal shape
 * there, and left unhandled it produces an unusable upstream that fails at request time rather
 * than at boot. Anything with a scheme is passed through untouched.
 */
function withScheme(value: string): string {
  const v = value.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  // localhost is plain HTTP; a managed hostname is TLS-terminated by the platform.
  const local = v.startsWith('localhost') || v.startsWith('127.0.0.1');
  return `${local ? 'http' : 'https'}://${v}`;
}

export function resolveUpstreamFor(
  logical: string,
  devPort: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const direct = env[`UPSTREAM_${logical}`];
  if (direct) return withScheme(direct);

  const profile = splitProfile(env);
  if (profile === 'mono') {
    return withScheme(env.UPSTREAM_MONO ?? 'http://localhost:3000');
  }
  if (profile === 'axis6') {
    const runtime = AXIS6[logical];
    if (runtime) {
      const configured = env[`UPSTREAM_${runtime}`];
      if (configured) return withScheme(configured);
      const derived = deriveSiblingHost(runtime, env);
      if (derived) return withScheme(derived);
      return `http://localhost:${DEV_PORTS[runtime] ?? devPort}`;
    }
  }
  return `http://localhost:${devPort}`;
}
