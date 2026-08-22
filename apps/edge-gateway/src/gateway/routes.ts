/**
 * Edge routing table (§A12.1). Ordered, first-match-wins path rules → upstream service. Specific
 * rules come first because a few prefixes are shared across services:
 *   - `/users/:id/stars` + `/users/:id/conversations/*` are chat-service (chat extras), while
 *     `/users/:id/profile|contacts` are user-service.
 *   - `/conversations/dm` + `/conversations/:id/members` are group-channel; the rest of
 *     `/conversations/*` (messages, pins, state) are chat-service.
 * Upstream base URLs default to the dev localhost ports; override per service with
 * `UPSTREAM_<SERVICE>` (e.g. UPSTREAM_CHAT=http://chat-service:3004) in prod / K8s.
 */
import { resolveUpstreamFor } from './topology';

export interface Route {
  test: RegExp;
  service: string;
  port: number;
}

const R = (test: RegExp, service: string, port: number): Route => ({ test, service, port });

export const ROUTES: Route[] = [
  R(/^\/(auth|\.well-known)(\/|$)/, 'AUTH', 3002),
  // The bare inbox list (a user's conversations) is owned by group-channel (it holds the
  // conversations + membership tables). MUST precede the chat rule below, which otherwise
  // catches every /users/:id/conversations* — the sub-paths (/archived, /pinned, /:id/state)
  // stay on chat-service.
  R(/^\/users\/[^/]+\/conversations\/?$/, 'GROUP_CHANNEL', 3005),
  // chat-service extras reuse the /users prefix — match these BEFORE the user-service catch-all.
  R(/^\/users\/[^/]+\/(stars|conversations)(\/|$)/, 'CHAT', 3004),
  R(/^\/(users|orgs|workspaces|teams|memberships|authorize|admin|discovery)(\/|$)/, 'USER', 3003),
  // /conversations is split: dm + members + role + notif + bare details → group-channel;
  // everything else under /conversations/:id (messages, pins, state) → chat.
  R(/^\/conversations\/dm(\/|$)/, 'GROUP_CHANNEL', 3005),
  R(/^\/conversations\/[^/]+\/members(\/|$)/, 'GROUP_CHANNEL', 3005),
  R(/^\/conversations\/[^/]+\/notif(\/|$)/, 'GROUP_CHANNEL', 3005),
  R(/^\/conversations\/[^/]+\/?$/, 'GROUP_CHANNEL', 3005), // GET details (single segment only)
  R(/^\/conversations(\/|$)/, 'CHAT', 3004),
  R(/^\/(chat|polls|messages)(\/|$)/, 'CHAT', 3004),
  R(/^\/(groups|channels|communities|broadcasts)(\/|$)/, 'GROUP_CHANNEL', 3005),
  R(/^\/(presence|status)(\/|$)/, 'PRESENCE', 3006),
  R(/^\/(notifications|mail)(\/|$)/, 'NOTIFICATION', 3007),
  R(/^\/(media|backups)(\/|$)/, 'MEDIA', 3008),
  R(/^\/search(\/|$)/, 'SEARCH', 3009),
  R(/^\/(calls|meetings)(\/|$)/, 'CALL', 3010),
  R(/^\/(automation|lists|clips|canvas|feature-flags)(\/|$)/, 'AUTOMATION', 3011),
  R(/^\/ai(\/|$)/, 'AI', 3012),
];

/**
 * Base URL for a route's upstream. Resolution is delegated to `topology.ts`, which maps the logical
 * service to whichever runtime service owns it under the active `SPLIT_PROFILE` — so this table
 * stays a description of the PUBLIC API and never has to change when services are merged or split.
 */
export function upstreamFor(route: Route): string {
  return resolveUpstreamFor(route.service, route.port);
}

/** Resolve a request path to an upstream base URL, or null if the gateway handles it itself. */
export function resolveUpstream(path: string): string | null {
  const clean = path.split('?')[0]?.split('#')[0] ?? ''; // match on the path only, ignore query/hash
  const route = ROUTES.find((r) => r.test.test(clean));
  return route ? upstreamFor(route) : null;
}
