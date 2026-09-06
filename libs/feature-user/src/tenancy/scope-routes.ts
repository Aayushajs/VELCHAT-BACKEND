/**
 * Constrain tenancy's scope routes to the scopes that actually exist.
 *
 * These were registered as `:scopeType/:scopeId/...` on a prefix-less controller, which matches
 * ANY path of that shape. That was harmless while tenancy had a process to itself; the 13→6
 * consolidation put every feature in ONE Nest app, where this pattern registers first and
 * captures other features' routes — most damagingly `GET /conversations/:id/members`.
 *
 * The damage is not a visible 404. The tenancy handler runs, treats the conversation id as a
 * scope id, and fails on anything that is not a UUID. That endpoint is exactly what the realtime
 * membership projection calls to heal itself when its cache is cold — so it could never heal, and
 * fan-out dropped every message whose members it could not resolve. Silent, total, and
 * indistinguishable from "realtime is broken".
 *
 * Both spellings are accepted because the public API is plural (`/orgs/...`, routed that way by
 * the gateway) while the internal `ScopeType` is singular; narrowing the route is a routing fix
 * and must not quietly change which requests are served.
 */
export const SCOPE_SEGMENTS = ['orgs', 'workspaces', 'teams', 'org', 'workspace', 'team'] as const;

/** A route whose first segment can only ever be a scope — never another feature's collection. */
export function scopeRoute(suffix: string): string {
  return `:scopeType(${SCOPE_SEGMENTS.join('|')})/${suffix}`;
}
