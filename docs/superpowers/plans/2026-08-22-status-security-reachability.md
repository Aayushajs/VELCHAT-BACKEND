# Status Phase 1 — Security & Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VelChat Status API reachable in every deployment profile and make every access decision server-authoritative, closing a full IDOR/impersonation bypass and an unenforceable privacy audience.

**Architecture:** `libs/feature-status` keeps owning the domain; the gateway route is repointed at the runtime service that actually mounts it; caller identity moves to the verified JWT via `@CurrentUser`; audience is evaluated live against the social graph through a new fail-closed port in `libs/feature-contracts` (so `feature-status` never imports `feature-user`); statuses gain a lifecycle so delete is soft and expiry is swept by a worker while still being enforced at read time.

**Tech Stack:** TypeScript, NestJS 10, Postgres (`pg` via `@velchat/database`), Valkey (`ioredis` via `@velchat/cache`), Jest + ts-jest, pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-08-22-status-security-reachability-design.md`

---

## Background an engineer needs before starting

Read the spec first. Then absorb these five facts about this codebase, because the plan depends on all of them:

1. **Six runtime services, thin composition roots.** Domains live in `libs/feature-*`; `apps/*` are ~18-line composition roots. A `feature-*` lib **must not import another `feature-*` lib** (enforced by eslint). Cross-feature calls go through a port interface in `libs/feature-contracts`, wired by the composition root.
2. **The gateway routes by *logical* service name.** `apps/edge-gateway/src/gateway/routes.ts` maps a path regex to a logical name; `topology.ts` maps that logical name to the runtime service that owns it under the active `SPLIT_PROFILE`. Fixing routing means changing the logical name in `routes.ts`, not the ports.
3. **Every JSON response is enveloped.** `ResponseInterceptor` wraps handler output as `{ success, statusCode, message, data }`. Any service-to-service HTTP client must read `body.data`.
4. **Identity comes from the token, never the request.** `@CurrentUser('accountId')` (from `@velchat/common`) reads the verified `VerifiedPrincipal { accountId, deviceId, tenantId?, role?, scope? }`. Taking identity from a body or query is the bug this plan fixes.
5. **Modules that own background work return `{ module, wiring }`.** See `FeatureFlagsModule.forRoot` in `libs/feature-automation/src/feature-flags/feature-flags.module.ts`. The composition root then does `m.workers.push(wiring.worker)`. `StatusModule.forRoot` currently returns a bare `DynamicModule` and must adopt this shape.

**Run tests for one lib** with `pnpm --filter @velchat/feature-status test`. Run one file with `pnpm --filter @velchat/feature-status test -- status.service.spec`. Repo-wide gates are `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`.

**Commit convention:** Conventional Commits, and the scope must come from the commitlint enum (`feature-status`, `feature-contracts`, `composition`, `edge-gateway`, `database`, `docs`, …). `status` is **not** a valid scope. Do **not** add a `Co-Authored-By` trailer.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/edge-gateway/src/gateway/routes.ts` | **Modify.** Split the combined `presence|status` rule so `/status` uses logical name `STATUS`. |
| `apps/edge-gateway/test/unit/routes.spec.ts` | **Create or extend.** Assert `/status/*` resolves to the content upstream and `/presence/status` still resolves to realtime. |
| `libs/feature-contracts/src/social-graph.ts` | **Create.** `SocialRelationship`, `SocialGraphResolver`, `HttpSocialGraphResolver`. Fail-closed. |
| `libs/feature-contracts/src/social-graph.spec.ts` | **Create.** Fail-closed + envelope-unwrapping + both block directions. |
| `libs/feature-contracts/src/index.ts` | **Modify.** Export the new port. |
| `migrations/src/sql/0023_status_lifecycle.sql` | **Create.** `state`, `deleted_at`, indexes. Expand-only. |
| `libs/feature-status/src/status/status.types.ts` | **Modify.** Add `StatusState`, replace snapshot audience helper with rule evaluation. |
| `libs/feature-status/src/status/status.dto.ts` | **Modify.** Delete `userId`, `contacts`, `viewerId`. Add `clientStatusId`. |
| `libs/feature-status/src/status/status.repository.ts` | **Modify.** Filter on `state`, soft delete, cursor viewers, two-stage expiry. |
| `libs/feature-status/src/status/status.service.ts` | **Modify.** Live audience+block evaluation, acting identity as a parameter. |
| `libs/feature-status/src/status/status.controller.ts` | **Modify.** `@CurrentUser('accountId')` on every endpoint. |
| `libs/feature-status/src/status/status.expiry.worker.ts` | **Create.** Overlap-guarded two-stage sweep. |
| `libs/feature-status/src/status/status.module.ts` | **Modify.** Return `{ module, wiring }`; accept the resolver, redis, logger. |
| `libs/composition/src/groups.ts` | **Modify.** Add `valkey` to `contentGroup.need`; build the resolver; push the worker. |
| `libs/composition/src/groups.spec.ts` | **Modify.** Update the content-group datastore assertion. |
| `libs/feature-status/test/unit/*.spec.ts` | **Create/modify.** Security regression, audience matrix, lifecycle, expiry idempotency, E2EE payload. |
| `docs/status/SECURITY.md` | **Create.** The threats closed and how. |
| `docs/API-ENDPOINTS.md` | **Modify.** Move Status off realtime-service; document the token-derived identity. |

---

## Task 1: Repoint the `/status` gateway route

The whole API currently 404s under the default profile. This is the smallest change with the largest effect, so it lands first and independently.

**Files:**
- Modify: `apps/edge-gateway/src/gateway/routes.ts:40`
- Test: `apps/edge-gateway/test/unit/routes.spec.ts`

- [ ] **Step 1: Look at what exists**

Run: `ls apps/edge-gateway/test/unit/ 2>/dev/null || echo "no test dir"`

If `routes.spec.ts` already exists, append the `describe` block from Step 2 to it. If not, create the file with the full content from Step 2.

- [ ] **Step 2: Write the failing test**

Create (or append to) `apps/edge-gateway/test/unit/routes.spec.ts`:

```ts
import { resolveUpstream } from '../../src/gateway/routes';

describe('status routing (Phase 1 — regression for the wrong-upstream defect)', () => {
  const ENV_KEYS = ['SPLIT_PROFILE', 'UPSTREAM_CONTENT', 'UPSTREAM_REALTIME', 'UPSTREAM_STATUS'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.UPSTREAM_CONTENT = 'http://content:3008';
    process.env.UPSTREAM_REALTIME = 'http://realtime:3006';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // The defect: /status resolved to the realtime upstream, which does not mount StatusModule.
  it.each(['axis6', 'full13'])('routes /status to the content upstream under %s', (profile) => {
    process.env.SPLIT_PROFILE = profile;
    expect(resolveUpstream('/status')).toBe('http://content:3008');
    expect(resolveUpstream('/status/abc/viewers')).toBe('http://content:3008');
  });

  it('keeps /presence on the realtime upstream', () => {
    process.env.SPLIT_PROFILE = 'axis6';
    expect(resolveUpstream('/presence')).toBe('http://realtime:3006');
  });

  // /presence/status is RICH PRESENCE and legitimately belongs to realtime. Splitting the rule
  // must not steal it, which is why both rules are start-anchored.
  it('keeps /presence/status on the realtime upstream', () => {
    process.env.SPLIT_PROFILE = 'axis6';
    expect(resolveUpstream('/presence/status')).toBe('http://realtime:3006');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @velchat/edge-gateway test -- routes.spec`

Expected: the two `/status` cases FAIL, reporting `"http://realtime:3006"` received where `"http://content:3008"` was expected. The `/presence` cases pass already. If the `/status` cases *pass* here, stop — the defect may already be fixed and this plan needs revisiting.

- [ ] **Step 4: Make the change**

In `apps/edge-gateway/src/gateway/routes.ts`, replace this single line:

```ts
  R(/^\/(presence|status)(\/|$)/, 'PRESENCE', 3006),
```

with two start-anchored rules:

```ts
  R(/^\/presence(\/|$)/, 'PRESENCE', 3006),
  // Stories are owned by feature-status, mounted in the CONTENT group — not realtime. The
  // combined presence|status rule sent these to realtime, where no StatusController exists,
  // so the whole API 404'd under axis6/full13 and only worked under mono.
  R(/^\/status(\/|$)/, 'STATUS', 3008),
```

`topology.ts` already contains `STATUS: 'CONTENT'`, so no change is needed there — this activates an entry that was previously dead code.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @velchat/edge-gateway test -- routes.spec`

Expected: PASS, all four cases.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-gateway/src/gateway/routes.ts apps/edge-gateway/test/unit/routes.spec.ts
git commit -m "fix(edge-gateway): route /status to content, not realtime

/status resolved to the logical service PRESENCE, which topology maps to
realtime-service, but StatusModule is mounted only in the content group. The
STATUS -> CONTENT entry already existed in topology and was dead code because
no route referenced it. Every /status request therefore reached a process with
no StatusController and no Postgres pool, so the API 404'd under axis6 (the
default) and full13, and appeared to work only under mono where all groups
share one process.

Both replacement rules stay start-anchored so /presence/status (rich presence,
legitimately realtime-owned) is unaffected."
```

---

## Task 2: The fail-closed social-graph port

`feature-status` cannot import `feature-user`, and it must stop trusting the client's contact list. This task builds the port with no consumer yet, so it is testable in isolation.

**Files:**
- Create: `libs/feature-contracts/src/social-graph.ts`
- Create: `libs/feature-contracts/src/social-graph.spec.ts`
- Modify: `libs/feature-contracts/src/index.ts`

- [ ] **Step 1: Read the pattern to copy**

Run: `sed -n '17,100p' libs/feature-contracts/src/membership.ts`

`HttpMembershipResolver` is the template: base-URL scheme validation, `x-velchat-internal` header, `redirect: 'error'`, an `AbortController` timeout, and in-flight coalescing. Copy that hardening. The one thing **not** to copy is its failure direction — it fails *empty*; this resolver fails *closed*.

- [ ] **Step 2: Write the failing test**

Create `libs/feature-contracts/src/social-graph.spec.ts`:

```ts
import { HttpSocialGraphResolver } from './social-graph';

const OPTS = { baseUrl: 'http://identity:3003', secret: 's3cret', timeoutMs: 50 };

/** Responses are enveloped by ResponseInterceptor: { success, statusCode, message, data }. */
function envelope(data: unknown) {
  return { ok: true, json: async () => ({ success: true, statusCode: 200, message: 'OK', data }) };
}

describe('HttpSocialGraphResolver', () => {
  let fetchMock: jest.SpyInstance;
  afterEach(() => fetchMock?.mockRestore());

  function mockFetch(handler: (url: string) => unknown) {
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((url: string) => Promise.resolve(handler(url))) as never);
  }

  it('rejects a non-http base URL so a mis-set env var cannot become an SSRF primitive', () => {
    expect(() => new HttpSocialGraphResolver({ ...OPTS, baseUrl: 'file:///etc/passwd' })).toThrow();
  });

  it('reads the contact list out of the response envelope', async () => {
    mockFetch((url) =>
      url.includes('/contacts/') // reverse block probe
        ? envelope({ blocked: false })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: false }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: false,
    });
  });

  it('is not a contact when absent from the owner list', async () => {
    mockFetch((url) =>
      url.includes('/contacts/') ? envelope({ blocked: false }) : envelope([]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'stranger')).resolves.toEqual({
      isContact: false,
      isBlocked: false,
    });
  });

  it('blocks when the OWNER blocked the viewer (blocked flag on the contact row)', async () => {
    mockFetch((url) =>
      url.includes('/contacts/')
        ? envelope({ blocked: false })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: true }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: true,
    });
  });

  it('blocks when the VIEWER blocked the owner (reverse direction)', async () => {
    mockFetch((url) =>
      url.includes('/contacts/')
        ? envelope({ blocked: true })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: false }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: true,
    });
  });

  // The single most important behaviour in this file: an answer we could not obtain must never
  // read as permission.
  it('fails CLOSED when the upstream errors', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: false,
      isBlocked: true,
    });
  });

  it('fails CLOSED on a non-2xx upstream response', async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }));
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: false,
      isBlocked: true,
    });
  });

  it('sends the internal shared secret', async () => {
    mockFetch(() => envelope([]));
    const r = new HttpSocialGraphResolver(OPTS);
    await r.relationship('owner', 'viewer');
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['x-velchat-internal']).toBe('s3cret');
  });

  it('encodes ids so a caller-supplied id cannot walk the path', async () => {
    mockFetch(() => envelope([]));
    const r = new HttpSocialGraphResolver(OPTS);
    await r.relationship('../../admin', 'viewer');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('../..');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @velchat/feature-contracts test -- social-graph`

Expected: FAIL — `Cannot find module './social-graph'`.

- [ ] **Step 4: Write the implementation**

Create `libs/feature-contracts/src/social-graph.ts`:

```ts
/**
 * How a viewer relates to a content owner, as far as visibility is concerned.
 *
 * This is the one question feature-status needs about a domain it does not own. Rather than let it
 * import feature-user — which would weld the 6-service topology in place — it depends on this port,
 * and the composition root decides how the question is answered.
 */
export interface SocialRelationship {
  /** `viewer` is in `owner`'s contact list. */
  isContact: boolean;
  /** Either party has blocked the other. */
  isBlocked: boolean;
}

export interface SocialGraphResolver {
  relationship(owner: string, viewer: string): Promise<SocialRelationship>;
}

export interface HttpSocialGraphResolverOptions {
  /** Base URL of the service that owns the directory. From configuration ONLY — never a request. */
  baseUrl: string;
  /** Shared secret for service-to-service calls, sent as `x-velchat-internal`. */
  secret: string;
  /** Upstream budget. Exceeding it is treated as an upstream failure. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Denied, and the reason we could not confirm otherwise is irrelevant to the caller. */
const DENY: SocialRelationship = { isContact: false, isBlocked: true };

interface ContactRow {
  contact_user_id: string;
  blocked: boolean;
}

/**
 * HTTP implementation, talking to whichever service owns the directory.
 *
 * Fails **closed**, unlike `MembershipResolver.members()` which fails empty. That asymmetry is
 * deliberate: `members` drives best-effort live fan-out with a durable cursor catch-up behind it, so
 * an empty answer delays a message but cannot lose one. Here there is no backstop — an answer that
 * could not be obtained must not read as permission.
 *
 * Concurrent lookups of the same owner share one request. Without that, one cold cache on a popular
 * author turns a single miss into hundreds of simultaneous upstream calls.
 */
export class HttpSocialGraphResolver implements SocialGraphResolver {
  private readonly inflight = new Map<string, Promise<ContactRow[] | null>>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: HttpSocialGraphResolverOptions) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      // Validating a configured URL keeps a mis-set env var from turning this client into an
      // SSRF primitive (file:, gopher:, …).
      throw new Error(`SocialGraphResolver baseUrl must be http(s), got "${url.protocol}"`);
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async relationship(owner: string, viewer: string): Promise<SocialRelationship> {
    if (!owner || !viewer) return DENY;

    const [contacts, viewerBlockedOwner] = await Promise.all([
      this.contactsOf(owner),
      this.hasBlocked(viewer, owner),
    ]);

    // Either lookup failing means we cannot answer, so we deny.
    if (contacts === null || viewerBlockedOwner === null) return DENY;

    const row = contacts.find((c) => c.contact_user_id === viewer);
    return {
      isContact: row !== undefined,
      isBlocked: viewerBlockedOwner || (row?.blocked ?? false),
    };
  }

  /** The owner's contact list, or `null` when it could not be determined. */
  private contactsOf(owner: string): Promise<ContactRow[] | null> {
    const existing = this.inflight.get(owner);
    if (existing) return existing;

    const work = this.fetchContacts(owner).finally(() => this.inflight.delete(owner));
    this.inflight.set(owner, work);
    return work;
  }

  private async fetchContacts(owner: string): Promise<ContactRow[] | null> {
    const body = await this.get(`/users/${encodeURIComponent(owner)}/contacts`);
    if (body === null) return null;
    const data = unwrap(body);
    if (!Array.isArray(data)) return null;
    return data.flatMap((row) => {
      const r = row as Partial<ContactRow>;
      return typeof r.contact_user_id === 'string'
        ? [{ contact_user_id: r.contact_user_id, blocked: r.blocked === true }]
        : [];
    });
  }

  /** Has `owner` blocked `other`? `null` when it could not be determined. */
  private async hasBlocked(owner: string, other: string): Promise<boolean | null> {
    const body = await this.get(
      `/users/${encodeURIComponent(owner)}/contacts/${encodeURIComponent(other)}/blocked`,
    );
    if (body === null) return null;
    const data = unwrap(body);
    if (data === null || typeof data !== 'object') return null;
    return (data as { blocked?: unknown }).blocked === true;
  }

  /** GET with timeout + internal secret. `null` on any failure — callers translate that to a deny. */
  private async get(path: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        redirect: 'error', // a redirect would move the secret to an unintended host
        headers: { 'x-velchat-internal': this.opts.secret },
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null; // timeout, abort, DNS, connection refused — all "unknown", never "allowed"
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Unwrap the standard `{ success, statusCode, message, data }` response envelope. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}
```

- [ ] **Step 5: Export it**

In `libs/feature-contracts/src/index.ts`, append:

```ts
export {
  HttpSocialGraphResolver,
  type SocialGraphResolver,
  type SocialRelationship,
  type HttpSocialGraphResolverOptions,
} from './social-graph';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @velchat/feature-contracts test -- social-graph`

Expected: PASS, all ten cases. Then `pnpm --filter @velchat/feature-contracts typecheck` — expected: clean.

- [ ] **Step 7: Commit**

```bash
git add libs/feature-contracts/src/social-graph.ts libs/feature-contracts/src/social-graph.spec.ts libs/feature-contracts/src/index.ts
git commit -m "feat(feature-contracts): add fail-closed SocialGraphResolver port

Status needs to know whether a viewer is one of an author's contacts and
whether either party blocked the other. That is feature-user's domain, and a
feature lib may not import another feature lib, so it becomes a port the
composition root wires.

Fails closed, unlike MembershipResolver.members() which fails empty: members
drives best-effort fan-out with a durable cursor catch-up behind it, whereas
this answers an authorization question with no backstop. Unwraps the standard
response envelope, checks both block directions, and coalesces concurrent
lookups of the same owner."
```

---

## Task 3: Status lifecycle migration

**Files:**
- Create: `migrations/src/sql/0023_status_lifecycle.sql`

- [ ] **Step 1: Confirm the next migration number and the existing table**

Run: `ls migrations/src/sql/ | tail -3 && sed -n '6,22p' migrations/src/sql/0007_status.sql`

Expected: the highest existing file is `0022_contact_sync.sql`, so `0023` is next. The `status_posts` table has no `state` and no `deleted_at`.

- [ ] **Step 2: Write the migration**

Create `migrations/src/sql/0023_status_lifecycle.sql`:

```sql
-- 0023 — status lifecycle. Expand-only.
--
-- 0007 gave status_posts no lifecycle: delete was a hard DELETE that cascaded status_views away
-- (destroying the author's viewer data and any audit trail), and expiry was never actioned because
-- nothing called purgeExpired(). This adds the state a soft delete and a two-stage expiry sweep
-- need.
--
-- Reads filter `state = 'active' AND expires_at > now()`, so expiry and deletion are enforced at
-- READ time and remain correct even if the sweep worker is down. The worker only does cleanup and
-- event emission; it is never load-bearing for correctness.

ALTER TABLE status_posts
  ADD COLUMN IF NOT EXISTS state      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 'creating' | 'processing' | 'failed' are reserved for the Phase 2 media pipeline and are
-- unreachable today; they are in the constraint now so Phase 2 needs no second migration.
ALTER TABLE status_posts
  DROP CONSTRAINT IF EXISTS status_state_chk;
ALTER TABLE status_posts
  ADD CONSTRAINT status_state_chk
  CHECK (state IN ('creating', 'processing', 'active', 'failed', 'deleted', 'expired'));

-- Owner's own list, and the tray candidate scan in Phase 2.
CREATE INDEX IF NOT EXISTS status_owner_active_idx
  ON status_posts (user_id, state, created_at DESC);

-- The expiry sweep's predicate.
CREATE INDEX IF NOT EXISTS status_expiry_sweep_idx
  ON status_posts (state, expires_at);

-- Cursor pagination over the viewer list. The primary key is (status_id, viewer_id), which cannot
-- serve an ordered scan by viewed_at.
CREATE INDEX IF NOT EXISTS status_views_cursor_idx
  ON status_views (status_id, viewed_at);
```

- [ ] **Step 3: Verify it is syntactically valid and idempotent**

Run: `pnpm --filter @velchat/migrations build`

Expected: clean. If a local Postgres is available, apply it twice — the second run must be a no-op, since every statement is `IF NOT EXISTS` or `DROP ... IF EXISTS` first:

```bash
pnpm --filter @velchat/migrations start && pnpm --filter @velchat/migrations start
```

Expected: both runs succeed. If no local Postgres is available, note that and rely on CI.

- [ ] **Step 4: Commit**

```bash
git add migrations/src/sql/0023_status_lifecycle.sql
git commit -m "feat(database): add status lifecycle state and indexes

Expand-only. status_posts had no lifecycle, so delete was a hard DELETE that
cascaded status_views away and expiry was never actioned. Adds state +
deleted_at, a CHECK covering the Phase 2 media states so no second migration
is needed, and three indexes: the owner list, the expiry sweep predicate, and
an ordered (status_id, viewed_at) index for cursor pagination over viewers
that the (status_id, viewer_id) primary key cannot serve."
```

---

## Task 4: Rule-based audience evaluation in the domain types

Pure functions first, so the authorization logic is tested with no I/O.

**Files:**
- Modify: `libs/feature-status/src/status/status.types.ts`
- Test: `libs/feature-status/test/unit/audience.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `libs/feature-status/test/unit/audience.spec.ts`:

```ts
import { canView, type Audience } from '../../src/status/status.types';

const CONTACT = { isContact: true, isBlocked: false };
const STRANGER = { isContact: false, isBlocked: false };
const BLOCKED_CONTACT = { isContact: true, isBlocked: true };

describe('canView — the single authorization decision for a status', () => {
  it('lets the author see their own status regardless of rule or relationship', () => {
    const a: Audience = { mode: 'only', list: ['someone-else'] };
    expect(canView({ audience: a, authorId: 'author' }, 'author', BLOCKED_CONTACT)).toBe(true);
  });

  describe('mode: contacts', () => {
    const audience: Audience = { mode: 'contacts' };
    it('allows a contact', () => {
      expect(canView({ audience, authorId: 'a' }, 'v', CONTACT)).toBe(true);
    });
    it('denies a non-contact', () => {
      expect(canView({ audience, authorId: 'a' }, 'v', STRANGER)).toBe(false);
    });
  });

  describe('mode: except', () => {
    const audience: Audience = { mode: 'except', list: ['bob'] };
    it('allows a contact not on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'alice', CONTACT)).toBe(true);
    });
    it('denies a contact on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'bob', CONTACT)).toBe(false);
    });
    it('denies a non-contact even when not on the list', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', STRANGER)).toBe(false);
    });
  });

  describe('mode: only', () => {
    const audience: Audience = { mode: 'only', list: ['carol'] };
    it('allows a listed viewer', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', CONTACT)).toBe(true);
    });
    it('allows a listed viewer who is not a contact (the list is explicit intent)', () => {
      expect(canView({ audience, authorId: 'a' }, 'carol', STRANGER)).toBe(true);
    });
    it('denies an unlisted viewer', () => {
      expect(canView({ audience, authorId: 'a' }, 'alice', CONTACT)).toBe(false);
    });
  });

  // A block overrides every mode, including an explicit `only` list — being named earlier does not
  // survive being blocked later.
  it.each(['contacts', 'except', 'only'] as const)('denies a blocked viewer under %s', (mode) => {
    const audience: Audience = { mode, list: ['v'] };
    expect(canView({ audience, authorId: 'a' }, 'v', BLOCKED_CONTACT)).toBe(false);
  });

  // Existing rows written before this change carry a materialised contact snapshot in
  // audience.list. Under `contacts` mode that list is ignored in favour of the live relationship,
  // which is strictly more correct — a removed contact loses access immediately.
  it('ignores a legacy materialised list under contacts mode', () => {
    const legacy: Audience = { mode: 'contacts', list: ['stale-follower'] };
    expect(canView({ audience: legacy, authorId: 'a' }, 'stale-follower', STRANGER)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @velchat/feature-status test -- audience`

Expected: FAIL — `canView` is not exported from `status.types`.

- [ ] **Step 3: Implement `canView` and the state type**

In `libs/feature-status/src/status/status.types.ts`, add `StatusState`, add `state`/`deleted_at` to `StatusPost`, and **replace** the exported `audienceAllows` function with `canView`:

```ts
/** Lifecycle (§3.4). `creating`/`processing`/`failed` are reserved for the Phase 2 media pipeline. */
export type StatusState = 'creating' | 'processing' | 'active' | 'failed' | 'deleted' | 'expired';

/** What a viewer's relationship to the author is — supplied by the SocialGraphResolver port. */
export interface ViewerRelationship {
  isContact: boolean;
  isBlocked: boolean;
}

/**
 * The single authorization decision for reading a status.
 *
 * Evaluated LIVE against the author's current social graph rather than against a snapshot taken at
 * post time, so removing a contact or blocking someone takes effect immediately. A pre-existing
 * `audience.list` under `contacts` mode is a legacy materialised snapshot and is deliberately
 * ignored.
 *
 * A block denies under every mode, including an explicit `only` list.
 */
export function canView(
  post: { audience: Audience; authorId: string },
  viewerId: string,
  rel: ViewerRelationship,
): boolean {
  if (viewerId === post.authorId) return true; // the author always sees their own
  if (rel.isBlocked) return false;

  const list = post.audience.list ?? [];
  switch (post.audience.mode) {
    case 'only':
      return list.includes(viewerId);
    case 'except':
      return rel.isContact && !list.includes(viewerId);
    case 'contacts':
    default:
      return rel.isContact;
  }
}
```

Then extend `StatusPost` with the two new columns:

```ts
export interface StatusPost {
  status_id: string;
  user_id: string;
  kind: StatusKind;
  media_id: string | null;
  text: string | null;
  bg: string | null;
  caption: string | null;
  audience: Audience;
  e2ee: boolean;
  view_once: boolean;
  state: StatusState;
  deleted_at: string | null;
  created_at: string;
  expires_at: string;
}
```

Delete the old `audienceAllows` export entirely — it encoded the snapshot model this task replaces, and leaving it would let a future caller reintroduce the bug.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @velchat/feature-status test -- audience`

Expected: PASS, all 14 cases.

- [ ] **Step 5: Remove the stale assertions from the old test**

`libs/feature-status/test/unit/status.service.spec.ts` has a `describe('audienceAllows (§B8)')` block importing the deleted function, so it will not compile. Delete that entire `describe` block and its `audienceAllows` import — `audience.spec.ts` supersedes it with strictly more coverage. Leave the rest of the file alone for now; Task 6 rewrites it.

Run: `pnpm --filter @velchat/feature-status typecheck`

Expected: errors remaining only in `status.service.ts` / `status.repository.ts` (they still reference the old model). Those are fixed in Task 5.

- [ ] **Step 6: Commit**

```bash
git add libs/feature-status/src/status/status.types.ts libs/feature-status/test/unit/audience.spec.ts libs/feature-status/test/unit/status.service.spec.ts
git commit -m "feat(feature-status): evaluate audience live instead of from a snapshot

Replaces audienceAllows with canView, which takes the viewer's live
relationship to the author rather than a contact set materialised at post
time. Removing a contact or blocking someone now takes effect immediately,
and a 1024-contact author no longer writes a 1024-element JSONB blob per
status that is re-read and linearly scanned on every access.

A block denies under every mode including an explicit 'only' list. Legacy
rows carrying a materialised list under 'contacts' mode have it ignored in
favour of the live check, which is strictly more correct. The old function is
deleted rather than deprecated so the snapshot model cannot be reintroduced."
```

---

## Task 5: Repository — state filtering, soft delete, cursor viewers, two-stage expiry

**Files:**
- Modify: `libs/feature-status/src/status/status.repository.ts`

- [ ] **Step 1: Rewrite the repository**

Replace the whole body of `libs/feature-status/src/status/status.repository.ts`:

```ts
import type { PostgresClient } from '@velchat/database';
import type { NewStatus, StatusPost, StatusViewer } from './status.types';

/** One page of viewers plus the cursor to continue from. */
export interface ViewerPage {
  viewers: StatusViewer[];
  /** Pass as `after` to get the next page; `null` when the list is exhausted. */
  nextCursor: string | null;
}

/**
 * Status/story metadata (§B8, Postgres). Personal status text is ciphertext — the server never
 * reads it.
 *
 * Every read filters `state = 'active' AND expires_at > now()`. That, not the sweep worker, is what
 * makes expiry and deletion correct: a worker outage delays cleanup but can never expose an expired
 * or deleted status.
 */
export class StatusRepository {
  constructor(private readonly pg: PostgresClient) {}

  async create(statusId: string, s: NewStatus, expiresAt: Date): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_posts(status_id, user_id, kind, media_id, text, bg, caption,
                                audience, e2ee, view_once, state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)`,
      [
        statusId,
        s.userId,
        s.kind,
        s.mediaId ?? null,
        s.text ?? null,
        s.bg ?? null,
        s.caption ?? null,
        JSON.stringify(s.audience),
        s.e2ee,
        s.viewOnce,
        expiresAt.toISOString(),
      ],
    );
  }

  async findActive(statusId: string): Promise<StatusPost | null> {
    const res = await this.pg.pool.query(
      `SELECT * FROM status_posts
       WHERE status_id = $1 AND state = 'active' AND expires_at > now()`,
      [statusId],
    );
    return (res.rows[0] as StatusPost | undefined) ?? null;
  }

  /** A user's still-active statuses, oldest first so sequential playback is chronological. */
  async listActiveByUser(userId: string): Promise<StatusPost[]> {
    const res = await this.pg.pool.query(
      `SELECT * FROM status_posts
       WHERE user_id = $1 AND state = 'active' AND expires_at > now()
       ORDER BY created_at ASC`,
      [userId],
    );
    return res.rows as StatusPost[];
  }

  /** Idempotent by primary key: a second view from another device cannot inflate the count. */
  async recordView(statusId: string, viewerId: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_views(status_id, viewer_id) VALUES ($1, $2)
       ON CONFLICT (status_id, viewer_id) DO NOTHING`,
      [statusId, viewerId],
    );
  }

  /**
   * One page of viewers, ordered by view time. Cursor pagination (never OFFSET) per §B1, served by
   * status_views_cursor_idx. `limit` is clamped by the caller.
   */
  async viewersPage(statusId: string, limit: number, after?: string): Promise<ViewerPage> {
    const res = await this.pg.pool.query(
      `SELECT viewer_id, viewed_at FROM status_views
       WHERE status_id = $1 AND ($2::timestamptz IS NULL OR viewed_at > $2::timestamptz)
       ORDER BY viewed_at ASC
       LIMIT $3`,
      [statusId, after ?? null, limit + 1], // +1 probes for a further page without a second query
    );
    const rows = res.rows as StatusViewer[];
    const page = rows.slice(0, limit);
    return {
      viewers: page,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.viewed_at ?? null) : null,
    };
  }

  async react(statusId: string, viewerId: string, emoji: string): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO status_reactions(status_id, viewer_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (status_id, viewer_id) DO UPDATE SET emoji = $3, ts = now()`,
      [statusId, viewerId, emoji],
    );
  }

  /**
   * Soft delete, author-scoped in the predicate so ownership is enforced in the same statement that
   * mutates. A hard DELETE would cascade status_views away, destroying the author's viewer data.
   */
  async softDelete(statusId: string, userId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      `UPDATE status_posts SET state = 'deleted', deleted_at = now()
       WHERE status_id = $1 AND user_id = $2 AND state = 'active'`,
      [statusId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Stage 1 of expiry: flip due rows to 'expired' and return their ids so events can be emitted.
   * Idempotent — the predicate only matches rows still active, so a re-run is a no-op and a crash
   * mid-pass loses nothing.
   */
  async markExpired(limit = 500): Promise<Array<{ status_id: string; user_id: string }>> {
    const res = await this.pg.pool.query(
      `UPDATE status_posts SET state = 'expired'
       WHERE status_id IN (
         SELECT status_id FROM status_posts
         WHERE state = 'active' AND expires_at <= now()
         ORDER BY expires_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING status_id, user_id`,
      [limit],
    );
    return res.rows as Array<{ status_id: string; user_id: string }>;
  }

  /**
   * Stage 2: hard-delete expired/deleted rows past the grace window. The window is what lets Phase 2
   * reclaim media asynchronously without racing this purge.
   */
  async purgeAfterGrace(graceHours: number): Promise<number> {
    const res = await this.pg.pool.query(
      `DELETE FROM status_posts
       WHERE state IN ('expired', 'deleted')
         AND expires_at <= now() - ($1 || ' hours')::interval`,
      [String(graceHours)],
    );
    return res.rowCount ?? 0;
  }
}
```

Note `FOR UPDATE SKIP LOCKED` in `markExpired`: it makes the sweep safe to run from more than one replica, which matters because content-service is horizontally scaled.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @velchat/feature-status typecheck`

Expected: errors now only in `status.service.ts` (it still calls `listByUser`, `viewers`, `delete`). Fixed in the next task.

- [ ] **Step 3: Commit**

```bash
git add libs/feature-status/src/status/status.repository.ts
git commit -m "feat(feature-status): state-filtered reads, soft delete, cursor viewers

Reads now filter state = 'active' AND expires_at > now(), which is what makes
expiry and deletion correct independently of the sweep worker: an outage
delays cleanup but cannot expose an expired or deleted status.

Delete becomes a soft delete with the author in the predicate, so ownership is
enforced by the same statement that mutates and status_views survives. The
unbounded viewer list becomes a cursor page served by the new index, probing
limit+1 to detect a further page without a second query. Expiry splits into an
idempotent mark stage (FOR UPDATE SKIP LOCKED, so it is safe from multiple
replicas) and a grace-windowed purge."
```

---

## Task 6: Service — acting identity, live authorization, idempotent create

**Files:**
- Modify: `libs/feature-status/src/status/status.service.ts`
- Test: `libs/feature-status/test/unit/status.service.spec.ts`

- [ ] **Step 1: Write the failing security-regression test**

Replace the contents of `libs/feature-status/test/unit/status.service.spec.ts`:

```ts
import { ForbiddenError, NotFoundError } from '@velchat/common';
import { StatusService } from '../../src/status/status.service';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';
import type { StatusPost } from '../../src/status/status.types';
import type { SocialGraphResolver } from '@velchat/feature-contracts';

function activePost(over: Partial<StatusPost> = {}): StatusPost {
  return {
    status_id: 's1',
    user_id: 'author',
    kind: 'text',
    media_id: null,
    text: 'ciphertext',
    bg: null,
    caption: null,
    audience: { mode: 'contacts' },
    e2ee: true,
    view_once: false,
    state: 'active',
    deleted_at: null,
    created_at: '2026-08-22T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

function setup(opts: { rel?: { isContact: boolean; isBlocked: boolean }; post?: StatusPost | null } = {}) {
  const post = opts.post === undefined ? activePost() : opts.post;
  const repo = {
    create: jest.fn(async () => undefined),
    findActive: jest.fn(async () => post),
    listActiveByUser: jest.fn(async () => (post ? [post] : [])),
    recordView: jest.fn(async () => undefined),
    viewersPage: jest.fn(async () => ({
      viewers: [{ viewer_id: 'alice', viewed_at: '2026-08-22T01:00:00.000Z' }],
      nextCursor: null,
    })),
    react: jest.fn(async () => undefined),
    softDelete: jest.fn(async () => true),
  } as unknown as StatusRepository;

  const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const social = {
    relationship: jest.fn(async () => opts.rel ?? { isContact: true, isBlocked: false }),
  } as unknown as SocialGraphResolver;

  return { svc: new StatusService(repo, events, social), repo, events, social };
}

// Each case here is a bypass that WAS exploitable because the service trusted a caller-supplied id.
describe('StatusService — security regressions', () => {
  it('refuses to delete a status the caller does not own', async () => {
    const { svc, repo } = setup();
    (repo.softDelete as jest.Mock).mockResolvedValue(false); // author-scoped predicate matches nothing
    await expect(svc.remove('s1', 'attacker')).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.softDelete).toHaveBeenCalledWith('s1', 'attacker');
  });

  it('refuses the viewer list to anyone but the author', async () => {
    const { svc } = setup();
    await expect(svc.viewers('s1', 'attacker', 50)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gives the viewer list to the author', async () => {
    const { svc } = setup();
    await expect(svc.viewers('s1', 'author', 50)).resolves.toEqual({
      viewers: [{ viewerId: 'alice', viewedAt: '2026-08-22T01:00:00.000Z' }],
      nextCursor: null,
    });
  });

  it('denies a non-contact reading an author feed', async () => {
    const { svc } = setup({ rel: { isContact: false, isBlocked: false } });
    await expect(svc.feedOf('author', 'stranger')).resolves.toEqual([]);
  });

  it('denies a blocked viewer on view, react and feed', async () => {
    const blocked = { isContact: true, isBlocked: true };
    const a = setup({ rel: blocked });
    await expect(a.svc.view('s1', 'v')).rejects.toBeInstanceOf(ForbiddenError);
    const b = setup({ rel: blocked });
    await expect(b.svc.react('s1', 'v', '👍')).rejects.toBeInstanceOf(ForbiddenError);
    const c = setup({ rel: blocked });
    await expect(c.svc.feedOf('author', 'v')).resolves.toEqual([]);
  });

  it('denies when the social graph cannot be reached (fail closed)', async () => {
    const { svc } = setup({ rel: { isContact: false, isBlocked: true } });
    await expect(svc.view('s1', 'v')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s on an expired or missing status rather than leaking existence', async () => {
    const { svc } = setup({ post: null });
    await expect(svc.view('gone', 'v')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.react('gone', 'v', '👍')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.viewers('gone', 'author', 50)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('StatusService — posting', () => {
  it('attributes the status to the acting account, not to any supplied field', async () => {
    const { svc, events } = setup();
    const res = await svc.post('acting-author', { kind: 'text', text: 'ciphertext' });
    expect(res.statusId).toBeDefined();
    expect(events.statusPosted).toHaveBeenCalledWith(
      res.statusId,
      'acting-author',
      'text',
      res.expiresAt,
    );
  });

  it('stores the audience RULE, not a materialised member list', async () => {
    const { svc, repo } = setup();
    await svc.post('author', { kind: 'text', audience: { mode: 'except', list: ['bob'] } });
    const stored = (repo.create as jest.Mock).mock.calls[0][1];
    expect(stored.audience).toEqual({ mode: 'except', list: ['bob'] });
  });

  it('sets a 24h server-authoritative expiry', async () => {
    const { svc } = setup();
    const before = Date.now();
    const res = await svc.post('author', { kind: 'text' });
    const ttl = new Date(res.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(23 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000 + 5_000);
  });

  // The E2EE boundary: content must not reach the event bus, its consumers, or a replay.
  it('never puts status content in the emitted event', async () => {
    const { svc, events } = setup();
    await svc.post('author', { kind: 'text', text: 'SECRET', caption: 'ALSO SECRET' });
    const serialised = JSON.stringify((events.statusPosted as jest.Mock).mock.calls[0]);
    expect(serialised).not.toContain('SECRET');
  });

  it('records a view for an allowed viewer and skips it for the author', async () => {
    const allowed = setup();
    await allowed.svc.view('s1', 'viewer');
    expect(allowed.repo.recordView).toHaveBeenCalledWith('s1', 'viewer');

    const own = setup();
    await own.svc.view('s1', 'author');
    expect(own.repo.recordView).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @velchat/feature-status test -- status.service`

Expected: FAIL — `StatusService` takes two constructor args, and `post` has the old single-object signature.

- [ ] **Step 3: Rewrite the service**

Replace the contents of `libs/feature-status/src/status/status.service.ts`:

```ts
import { uuidv7, ValidationError, NotFoundError, ForbiddenError } from '@velchat/common';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusRepository, type ViewerPage } from './status.repository';
import { StatusEvents } from './status.events';
import {
  canView,
  STATUS_TTL_MS,
  type Audience,
  type NewStatus,
  type StatusKind,
  type StatusPost,
} from './status.types';

/** Everything about a new status EXCEPT who is posting it — that comes from the verified token. */
export interface PostStatusInput {
  kind: StatusKind;
  mediaId?: string;
  /** Ciphertext for personal (e2ee) status — the server never sees plaintext. */
  text?: string;
  bg?: string;
  caption?: string;
  audience?: Audience;
  e2ee?: boolean;
  viewOnce?: boolean;
}

const MAX_VIEWER_PAGE = 100;
const DEFAULT_VIEWER_PAGE = 50;
const AUDIENCE_MODES = new Set(['contacts', 'except', 'only']);

/**
 * Status / stories (§B8 / §C11).
 *
 * Two rules hold this together. First, the acting account is always a parameter supplied by the
 * controller from the verified token — never a field the caller can set; that is what closes the
 * IDOR and impersonation bypasses. Second, visibility is decided live against the author's current
 * social graph through the SocialGraphResolver port, which fails closed, so a contact removal or a
 * new block takes effect immediately and an unreachable directory denies rather than allows.
 *
 * Personal status content is E2EE: `text`/`caption` are ciphertext the server stores and never
 * parses, and no content field is ever put on the event bus or into a log.
 */
export class StatusService {
  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
    private readonly social: SocialGraphResolver,
  ) {}

  async post(
    actingAccountId: string,
    input: PostStatusInput,
  ): Promise<{ statusId: string; expiresAt: string }> {
    if (!actingAccountId) throw new ForbiddenError('authentication required');
    if (!input.kind) throw new ValidationError('kind is required');
    if (input.kind === 'text' && !input.text) {
      throw new ValidationError('text status requires text');
    }
    if (input.kind !== 'text' && !input.mediaId) {
      throw new ValidationError(`${input.kind} status requires mediaId`);
    }

    const rule = normaliseAudience(input.audience);
    const statusId = uuidv7();
    // Server time only. A client-supplied expiry would let a caller pin a status forever.
    const expiresAt = new Date(Date.now() + STATUS_TTL_MS);

    const post: NewStatus = {
      userId: actingAccountId,
      kind: input.kind,
      mediaId: input.mediaId ?? null,
      text: input.text ?? null,
      bg: input.bg ?? null,
      caption: input.caption ?? null,
      audience: rule,
      e2ee: input.e2ee ?? true,
      viewOnce: input.viewOnce ?? false,
    };
    await this.repo.create(statusId, post, expiresAt);

    // No content in the payload — the E2EE boundary (§3.7).
    await this.events.statusPosted(
      statusId,
      actingAccountId,
      input.kind,
      expiresAt.toISOString(),
    );
    return { statusId, expiresAt: expiresAt.toISOString() };
  }

  /** Record a view. Idempotent at the repository's primary key, so extra devices cannot inflate it. */
  async view(statusId: string, actingAccountId: string): Promise<void> {
    const post = await this.requireVisible(statusId, actingAccountId);
    if (actingAccountId !== post.user_id) await this.repo.recordView(statusId, actingAccountId);
  }

  async react(statusId: string, actingAccountId: string, emoji: string): Promise<void> {
    if (!emoji) throw new ValidationError('emoji is required');
    await this.requireVisible(statusId, actingAccountId);
    await this.repo.react(statusId, actingAccountId, emoji);
  }

  /** Viewer list — the author only (§B8), cursor-paginated. */
  async viewers(
    statusId: string,
    actingAccountId: string,
    limit = DEFAULT_VIEWER_PAGE,
    after?: string,
  ): Promise<{ viewers: Array<{ viewerId: string; viewedAt: string }>; nextCursor: string | null }> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (post.user_id !== actingAccountId) {
      throw new ForbiddenError('only the author can see viewers');
    }
    const page: ViewerPage = await this.repo.viewersPage(
      statusId,
      clampLimit(limit),
      after,
    );
    return {
      viewers: page.viewers.map((v) => ({ viewerId: v.viewer_id, viewedAt: v.viewed_at })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * An author's active statuses that the caller may see, oldest first for sequential playback.
   * The relationship is resolved ONCE for the author, not per status — no N+1.
   */
  async feedOf(authorId: string, actingAccountId: string): Promise<Array<Record<string, unknown>>> {
    const posts = await this.repo.listActiveByUser(authorId);
    if (posts.length === 0) return [];

    const rel =
      authorId === actingAccountId
        ? { isContact: true, isBlocked: false }
        : await this.social.relationship(authorId, actingAccountId);

    return posts
      .filter((p) =>
        canView({ audience: p.audience, authorId: p.user_id }, actingAccountId, rel),
      )
      .map(toWireStatus);
  }

  async remove(statusId: string, actingAccountId: string): Promise<void> {
    // Ownership lives in the UPDATE predicate, so "not yours" and "not there" are indistinguishable
    // to the caller — deliberately, so this cannot be used to probe for others' status ids.
    if (!(await this.repo.softDelete(statusId, actingAccountId))) {
      throw new NotFoundError('status not found or not yours');
    }
  }

  /** Fetch + authorize in one place, so no read path can forget the check. */
  private async requireVisible(statusId: string, viewerId: string): Promise<StatusPost> {
    const post = await this.repo.findActive(statusId);
    if (!post) throw new NotFoundError('status not found or expired');
    if (post.user_id === viewerId) return post;

    const rel = await this.social.relationship(post.user_id, viewerId);
    if (!canView({ audience: post.audience, authorId: post.user_id }, viewerId, rel)) {
      throw new ForbiddenError('not in this status audience');
    }
    return post;
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_VIEWER_PAGE;
  return Math.min(Math.trunc(limit), MAX_VIEWER_PAGE);
}

/** Reject an unknown mode rather than silently falling back to a wider audience. */
function normaliseAudience(audience: Audience | undefined): Audience {
  if (!audience) return { mode: 'contacts' };
  if (!AUDIENCE_MODES.has(audience.mode)) {
    throw new ValidationError('audience.mode must be contacts, except or only');
  }
  const list = audience.list ?? [];
  if (audience.mode === 'only' && list.length === 0) {
    throw new ValidationError('audience.mode "only" requires a non-empty list');
  }
  return audience.mode === 'contacts' ? { mode: 'contacts' } : { mode: audience.mode, list };
}

function toWireStatus(p: StatusPost): Record<string, unknown> {
  return {
    statusId: p.status_id,
    authorId: p.user_id,
    kind: p.kind,
    mediaId: p.media_id,
    text: p.text, // ciphertext for personal — opaque to the server
    bg: p.bg,
    caption: p.caption,
    viewOnce: p.view_once,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
  };
}
```

- [ ] **Step 4: Add the dependency**

`feature-status` now imports `@velchat/feature-contracts`. Add it to `libs/feature-status/package.json` `dependencies`:

```json
    "@velchat/feature-contracts": "workspace:*",
```

Then run `pnpm install` from the repo root so the workspace link is created.

This does **not** violate the no-cross-feature-import rule: `feature-contracts` holds interfaces only and exists precisely to be shared.

- [ ] **Step 5: Update the event producer signature**

`statusPosted` loses its `audience` argument (the resolved list no longer exists, and shipping an audience list was metadata the consumer does not need). In `libs/feature-status/src/status/status.events.ts`, change the method to:

```ts
  async statusPosted(
    statusId: string,
    userId: string,
    kind: StatusKind,
    expiresAt: string,
  ): Promise<void> {
    await this.bus.publish<StatusPostedPayload>(
      'status.posted',
      buildEnvelope({
        eventType: 'status.posted',
        key: userId,
        producer: 'content-service', // was 'presence-service' — status is content-owned (Part H)
        tenantId: null,
        // No content fields: personal status text/caption are ciphertext and must not transit the
        // bus. Consumers resolve the audience themselves via the directory.
        payload: { status_id: statusId, user_id: userId, kind, expires_at: expiresAt },
      }),
    );
  }
```

Check whether `StatusPostedPayload` in `libs/shared-types/src/index.ts` declares `audience` as required. If it does, make it optional (`audience?: string[]`) rather than removing it, so the change stays additive for any future consumer:

Run: `grep -n "StatusPostedPayload" -A 8 libs/shared-types/src/index.ts`

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @velchat/feature-status test`

Expected: PASS for both `audience.spec.ts` and `status.service.spec.ts`. Then `pnpm --filter @velchat/feature-status typecheck` — expected: errors only in `status.controller.ts` and `status.module.ts`, fixed next.

- [ ] **Step 7: Commit**

```bash
git add libs/feature-status/src/status/status.service.ts libs/feature-status/src/status/status.events.ts libs/feature-status/package.json libs/shared-types/src/index.ts libs/feature-status/test/unit/status.service.spec.ts pnpm-lock.yaml
git commit -m "fix(feature-status): take acting identity as a parameter, authorize live

The service accepted the acting account inside its input object, so every
caller-supplied id was trusted. It is now an explicit first parameter that the
controller fills from the verified token, and visibility is resolved through
the fail-closed SocialGraphResolver instead of a client-supplied contact list.

Also: expiry is computed from server time only; an unknown audience mode is
rejected rather than falling back to a wider audience; the viewer page is
clamped; the feed resolves the relationship once per author rather than per
status; and status.posted carries no content field, so personal ciphertext
cannot transit the bus. Producer corrected to content-service per Part H.

Each security regression test corresponds to a previously exploitable bypass."
```

---

## Task 7: Controller — identity from the verified token

**Files:**
- Modify: `libs/feature-status/src/status/status.controller.ts`
- Modify: `libs/feature-status/src/status/status.dto.ts`

- [ ] **Step 1: Strip the spoofable fields from the DTOs**

In `libs/feature-status/src/status/status.dto.ts`: delete the `userId` property from `PostStatusDto`, delete the `contacts` property from `PostStatusDto`, and delete the `viewerId` property from `ReactStatusDto`. Remove the now-unused `IsArray` import if nothing else uses it.

Add a documented reason above `PostStatusDto`:

```ts
/**
 * A new status. Deliberately contains NO identity and NO contact list: the author comes from the
 * verified token, and the audience is resolved server-side from the directory. Accepting either
 * from the client made impersonation and audience-widening trivial.
 */
```

Add a paginated-viewers query DTO to the same file:

```ts
export class ViewersQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 100, description: 'Page size (clamped to 100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor: pass the previous page’s nextCursor.' })
  @IsOptional()
  @IsString()
  after?: string;
}
```

Add the imports this needs: `IsInt`, `Min` from `class-validator`, and `Type` from `class-transformer`. Check `class-transformer` is already a dependency:

Run: `grep -n "class-transformer" libs/feature-status/package.json package.json`

If it is absent from `libs/feature-status/package.json`, add `"class-transformer": "^0.5.1"` to its dependencies and re-run `pnpm install`.

- [ ] **Step 2: Rewrite the controller**

Replace the contents of `libs/feature-status/src/status/status.controller.ts`:

```ts
import { Controller, Post, Get, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CurrentUser } from '@velchat/common';
import { StatusService } from './status.service';
import { PostStatusDto, ReactStatusDto, ViewersQueryDto } from './status.dto';

/**
 * Status / stories REST (§B8 / §C11). Routed via the gateway: /status → content-service.
 *
 * Every endpoint takes its acting identity from the VERIFIED token via `@CurrentUser`, never from
 * the body or query. The previous version read `userId`/`viewerId`/`requesterId` off the request,
 * which allowed any caller to delete another user's status, read their viewer list, or post as
 * them (§D4 IDOR).
 */
@ApiTags('status')
@ApiBearerAuth('access-token')
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Post()
  @ApiOperation({
    summary: 'Post a status',
    description:
      'Author is the authenticated account. 24h server-set expiry. Personal `text`/`caption` are ' +
      'ciphertext — the server never reads them. Audience is a RULE resolved server-side.',
  })
  @ApiCreatedResponse({ description: '{ statusId, expiresAt }.' })
  post(@CurrentUser('accountId') accountId: string, @Body() body: PostStatusDto) {
    return this.status.post(accountId, body);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Record a view', description: 'Idempotent. Audience-checked.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: 'View recorded.' })
  @ApiForbiddenResponse({ description: 'Not in this status audience.' })
  view(@Param('id') id: string, @CurrentUser('accountId') accountId: string) {
    return this.status.view(id, accountId);
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'React to a status (emoji)', description: 'Idempotent per account.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiForbiddenResponse({ description: 'Not in this status audience.' })
  react(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: ReactStatusDto,
  ) {
    return this.status.react(id, accountId, body.emoji);
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Viewer list (author only)', description: 'Cursor-paginated.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: '{ viewers, nextCursor }.' })
  @ApiForbiddenResponse({ description: 'Only the author can see viewers.' })
  viewers(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Query() query: ViewersQueryDto,
  ) {
    return this.status.viewers(id, accountId, query.limit, query.after);
  }

  @Get('feed/:authorId')
  @ApiOperation({
    summary: 'An author’s active statuses visible to the caller',
    description: 'Audience-filtered server-side; oldest first for sequential playback.',
  })
  @ApiParam({ name: 'authorId', description: 'Author account_id.' })
  @ApiOkResponse({ description: 'Visible active statuses (may be empty).' })
  feed(@Param('authorId') authorId: string, @CurrentUser('accountId') accountId: string) {
    return this.status.feedOf(authorId, accountId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a status (author only)', description: 'Soft delete.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours.' })
  remove(@Param('id') id: string, @CurrentUser('accountId') accountId: string) {
    return this.status.remove(id, accountId);
  }
}
```

- [ ] **Step 3: Confirm `CurrentUser` is exported where you import it from**

Run: `grep -n "current-user" libs/common/src/index.ts`

Expected: a re-export of `CurrentUser`. If it is exported from a subpath instead, adjust the import to match — do not guess.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @velchat/feature-status typecheck`

Expected: one remaining error in `status.module.ts` (the service now needs three constructor args). Fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add libs/feature-status/src/status/status.controller.ts libs/feature-status/src/status/status.dto.ts libs/feature-status/package.json pnpm-lock.yaml
git commit -m "fix(feature-status): derive identity from the verified token

Replaces every caller-supplied identity with @CurrentUser('accountId'):
userId on post, viewerId on view and reactions, requesterId on viewers, and
userId on delete. Drops PostStatusDto.contacts, which let a client assert the
author's contact list and so widen its own audience.

Paths and methods are byte-identical, so correct callers already sending a
bearer token need no change; only the spoofable parameters are gone. Also adds
cursor pagination to the viewer list, which was previously unbounded."
```

---

## Task 8: Expiry worker

**Files:**
- Create: `libs/feature-status/src/status/status.expiry.worker.ts`
- Test: `libs/feature-status/test/unit/status.expiry.worker.spec.ts`

- [ ] **Step 1: Read the pattern to copy**

Run: `cat libs/feature-automation/src/feature-flags/flag-schedule.worker.ts`

Copy that shape: a `timer`, a `running` overlap guard, `start()`/`stop()`, a `tick()` whose outer `try/catch` swallows errors so a cold database cannot crash the process.

- [ ] **Step 2: Write the failing test**

Create `libs/feature-status/test/unit/status.expiry.worker.spec.ts`:

```ts
import { StatusExpiryWorker } from '../../src/status/status.expiry.worker';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';

const logger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
} as unknown as Parameters<typeof StatusExpiryWorker.prototype.constructor>[2];

function setup(due: Array<{ status_id: string; user_id: string }> = []) {
  const repo = {
    markExpired: jest.fn(async () => due),
    purgeAfterGrace: jest.fn(async () => 0),
  } as unknown as StatusRepository;
  const events = { statusExpired: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const worker = new StatusExpiryWorker(repo, events, logger as never, { graceHours: 24 });
  return { worker, repo, events };
}

describe('StatusExpiryWorker', () => {
  it('marks due statuses and emits one event each', async () => {
    const { worker, repo, events } = setup([
      { status_id: 's1', user_id: 'u1' },
      { status_id: 's2', user_id: 'u2' },
    ]);
    await worker.tick();
    expect(repo.markExpired).toHaveBeenCalled();
    expect(events.statusExpired).toHaveBeenCalledTimes(2);
    expect(repo.purgeAfterGrace).toHaveBeenCalledWith(24);
  });

  it('is a no-op when nothing is due', async () => {
    const { worker, events } = setup([]);
    await worker.tick();
    expect(events.statusExpired).not.toHaveBeenCalled();
  });

  // Re-running must be harmless: markExpired's predicate only matches still-active rows, so a
  // second pass finds nothing. This is what makes a crash mid-sweep safe.
  it('is idempotent across repeated ticks', async () => {
    const { worker, repo, events } = setup([{ status_id: 's1', user_id: 'u1' }]);
    await worker.tick();
    (repo.markExpired as jest.Mock).mockResolvedValue([]); // already expired
    await worker.tick();
    expect(events.statusExpired).toHaveBeenCalledTimes(1);
  });

  it('still purges when event emission fails, and does not throw', async () => {
    const { worker, repo, events } = setup([{ status_id: 's1', user_id: 'u1' }]);
    (events.statusExpired as jest.Mock).mockRejectedValue(new Error('bus down'));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(repo.purgeAfterGrace).toHaveBeenCalled();
  });

  it('swallows a repository failure so a cold database cannot crash the process', async () => {
    const { worker, repo } = setup();
    (repo.markExpired as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('does not overlap concurrent ticks', async () => {
    const { worker, repo } = setup();
    let release!: () => void;
    (repo.markExpired as jest.Mock).mockImplementation(
      () => new Promise((r) => (release = () => r([]))),
    );
    const first = worker.tick();
    await worker.tick(); // must return immediately, guarded
    release();
    await first;
    expect(repo.markExpired).toHaveBeenCalledTimes(1);
  });

  it('stop() clears the timer so start/stop is safe to repeat', () => {
    const { worker } = setup();
    worker.start();
    worker.start(); // second call must not create a second timer
    worker.stop();
    worker.stop();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @velchat/feature-status test -- expiry`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the worker**

Create `libs/feature-status/src/status/status.expiry.worker.ts`:

```ts
import type { Logger } from 'pino';
import type { StatusRepository } from './status.repository';
import type { StatusEvents } from './status.events';

export interface StatusExpiryOptions {
  /** How long an expired/deleted row is retained before hard deletion. */
  graceHours?: number;
  intervalMs?: number;
  /** Rows marked per pass, bounding the work a single tick can do. */
  batchSize?: number;
}

/**
 * Two-stage status expiry, same interval-worker shape as the automation JobWorker.
 *
 * This worker is deliberately NOT load-bearing for correctness: reads filter
 * `state = 'active' AND expires_at > now()`, so an expired status is already invisible before this
 * runs. The worker exists to emit `status.expired` (so clients can drop it from a tray live) and to
 * reclaim rows. A crash or a week of downtime therefore delays cleanup without ever exposing
 * expired content.
 *
 * Stage 1 marks due rows and is idempotent — its predicate matches only still-active rows, so a
 * re-run is a no-op. Stage 2 hard-deletes past the grace window, which is what lets Phase 2 reclaim
 * media asynchronously without racing the purge.
 */
export class StatusExpiryWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly graceHours: number;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
    private readonly logger: Logger,
    opts: StatusExpiryOptions = {},
  ) {
    this.graceHours = opts.graceHours ?? 24;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.batchSize = opts.batchSize ?? 500;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.repo.markExpired(this.batchSize);
      for (const row of expired) {
        try {
          await this.events.statusExpired(row.status_id, row.user_id);
        } catch (err) {
          // The row IS expired and already invisible; a failed notification must not stall the
          // sweep or get retried into a loop.
          this.logger.warn(
            { statusId: row.status_id, err: String(err) },
            'status.expired publish failed',
          );
        }
      }
      const purged = await this.repo.purgeAfterGrace(this.graceHours);
      if (expired.length > 0 || purged > 0) {
        this.logger.info({ expired: expired.length, purged }, 'status expiry pass');
      }
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'status expiry pass failed (db not ready?)');
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 5: Add the `statusExpired` producer**

In `libs/feature-status/src/status/status.events.ts`, add:

```ts
  /** No content, and no audience list — a client that cannot see the status simply ignores it. */
  async statusExpired(statusId: string, userId: string): Promise<void> {
    await this.bus.publish(
      'status.expired',
      buildEnvelope({
        eventType: 'status.expired',
        key: userId,
        producer: 'content-service',
        tenantId: null,
        payload: { status_id: statusId, user_id: userId },
      }),
    );
  }
```

`status.expired` is not yet in the `EventPayloads` map in `libs/shared-types/src/index.ts`. Add it next to `status.posted`:

```ts
/** A status reached its 24h TTL and is no longer readable (§B8). */
export interface StatusExpiredPayload {
  status_id: string;
  user_id: AccountId;
}
```

and in the `EventPayloads` interface:

```ts
  'status.expired': StatusExpiredPayload;
```

If `publish` is generically typed against `EventPayloads`, type the call as
`this.bus.publish<StatusExpiredPayload>('status.expired', …)` to match how `statusPosted` does it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @velchat/feature-status test -- expiry`

Expected: PASS, all seven cases.

- [ ] **Step 7: Commit**

```bash
git add libs/feature-status/src/status/status.expiry.worker.ts libs/feature-status/src/status/status.events.ts libs/feature-status/test/unit/status.expiry.worker.spec.ts libs/shared-types/src/index.ts
git commit -m "feat(feature-status): add two-stage expiry worker

purgeExpired() existed but nothing ever called it, so statuses were never
actioned at their TTL. Adds an overlap-guarded interval worker in the same
shape as the automation JobWorker: stage 1 marks due rows and emits
status.expired, stage 2 hard-deletes past a grace window so Phase 2 can
reclaim media asynchronously without racing the purge.

Deliberately not load-bearing for correctness — reads already filter on state
and expires_at, so downtime delays cleanup without exposing expired content. A
failed publish is logged rather than stalling the sweep, and a repository
failure is swallowed so a cold database cannot crash the process."
```

---

## Task 9: Wire it up in the composition root

**Files:**
- Modify: `libs/feature-status/src/status/status.module.ts`
- Modify: `libs/composition/src/groups.ts`
- Modify: `libs/composition/src/groups.spec.ts`

- [ ] **Step 1: Adopt the `{ module, wiring }` shape**

Replace the contents of `libs/feature-status/src/status/status.module.ts`:

```ts
import { Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { EventBus } from '@velchat/event-bus';
import type { PostgresClient } from '@velchat/database';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { StatusRepository } from './status.repository';
import { StatusEvents } from './status.events';
import { StatusExpiryWorker, type StatusExpiryOptions } from './status.expiry.worker';

export interface StatusModuleDeps {
  logger: Logger;
  pg: PostgresClient;
  eventBus: EventBus;
  /** Answers "may this viewer see this author's status?" — fails closed. */
  social: SocialGraphResolver;
  expiry?: StatusExpiryOptions;
}

export class StatusWiring {
  readonly repo: StatusRepository;
  readonly service: StatusService;
  readonly worker: StatusExpiryWorker;

  constructor(deps: StatusModuleDeps) {
    this.repo = new StatusRepository(deps.pg);
    const events = new StatusEvents(deps.eventBus);
    this.service = new StatusService(this.repo, events, deps.social);
    this.worker = new StatusExpiryWorker(this.repo, events, deps.logger, deps.expiry);
  }
}

/** Status / stories (§B8). Postgres-backed, so it lives in the content group, never in realtime. */
@Module({})
export class StatusModule {
  static forRoot(deps: StatusModuleDeps): { module: DynamicModule; wiring: StatusWiring } {
    const wiring = new StatusWiring(deps);
    const module: DynamicModule = {
      module: StatusModule,
      controllers: [StatusController],
      providers: [
        { provide: StatusService, useValue: wiring.service },
        { provide: StatusRepository, useValue: wiring.repo },
      ],
    };
    return { module, wiring };
  }
}
```

Update `libs/feature-status/src/index.ts` to export the wiring type too:

```ts
/** status feature — owns no infrastructure; the composition root injects it. */
export { StatusModule, StatusWiring, type StatusModuleDeps } from './status/status.module';
```

- [ ] **Step 2: Look at how the content group builds and what config is available**

Run: `sed -n '160,190p' libs/composition/src/groups.ts && grep -n "internalSecret\|INTERNAL_API_SECRET\|upstream" libs/config/src/*.ts | head -20`

You need two configuration values for the resolver: the base URL of the service that owns the directory (identity-service under `axis6`) and the internal shared secret. Reuse whatever existing config field supplies them — check how another feature obtains `INTERNAL_API_SECRET`:

Run: `grep -rn "x-velchat-internal\|internalSecret" --include="*.ts" libs/composition/src libs/config/src | head`

- [ ] **Step 3: Update the content group**

In `libs/composition/src/groups.ts`, add `'valkey'` to `contentGroup`'s `need`, construct the resolver, and push the worker. The `contentGroup` factory needs the config to read the upstream URL and secret, so change its signature to match the other groups that take `config` (e.g. `platformGroup(config, logger)`):

```ts
/** media + status/stories + E2EE chat backup. The CPU-heavy group (ffmpeg lives here). */
export const contentGroup = (config: AppConfig, logger: Logger): FeatureGroup => ({
  name: 'content',
  // valkey joins for status rate limiting and the Phase 2 tray cache. The binding constraint runs
  // the other way — REALTIME must stay Valkey-only so a content deploy cannot drop live sockets.
  need: ['postgres', 'storage', 'valkey', 'eventBus'],
  mount(infra): Mounted {
    const m = emptyMounted();
    const { postgres, storage, valkey, eventBus } = infra;

    if (postgres && storage && eventBus) {
      m.imports.push(MediaModule.forRoot({ logger, pg: postgres, storage, eventBus }));
    }
    // §C21 — the server stores ciphertext only; no event bus needed.
    if (postgres && storage) {
      m.imports.push(BackupModule.forRoot({ pg: postgres, storage }));
    }
    if (postgres && eventBus) {
      // Status authorization needs the social graph, which feature-user owns. A port keeps
      // feature-status from importing it, so the 6-service topology stays re-splittable.
      const social = new HttpSocialGraphResolver({
        baseUrl: config.upstreamIdentityUrl,
        secret: config.internalApiSecret,
      });
      const status = StatusModule.forRoot({ logger, pg: postgres, eventBus, social });
      m.imports.push(status.module);
      m.workers.push(status.wiring.worker);
    }
    return m;
  },
});
```

Substitute the real config field names you found in Step 2 for `config.upstreamIdentityUrl` and `config.internalApiSecret`. If no upstream-URL field exists on `AppConfig`, add one following the existing pattern for `UPSTREAM_*` env reading in `libs/config`, and add the variable to `.env.example` and each `deploy/*/.env.example`.

Add the import at the top of `groups.ts`:

```ts
import { HttpSocialGraphResolver } from '@velchat/feature-contracts';
```

Add `@velchat/feature-contracts` to `libs/composition/package.json` dependencies if it is not already there, then `pnpm install`.

- [ ] **Step 4: Update every caller of `contentGroup`**

Run: `grep -rn "contentGroup" --include="*.ts" libs/ apps/ | grep -v dist`

Update each call site to pass `config` first. Expect `allGroups(...)` in `libs/composition/src/groups.ts` and `apps/content-service/src/app.module.ts`.

- [ ] **Step 5: Update the group datastore test**

`libs/composition/src/groups.spec.ts` asserts each group's declared datastores. Run it to see the exact failure:

Run: `pnpm --filter @velchat/composition test -- groups`

Expected: FAIL on the content group's `need`. Update that assertion to include `valkey`. **Do not** weaken the realtime-group assertion — the test that realtime stays Valkey-only is the one protecting live sockets, and it must keep passing untouched.

- [ ] **Step 6: Verify the whole workspace**

Run each and fix anything that fails:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all green. `pnpm test` must show the pre-existing suites still passing plus the new status suites.

- [ ] **Step 7: Commit**

```bash
git add libs/feature-status/src/status/status.module.ts libs/feature-status/src/index.ts libs/composition/src/groups.ts libs/composition/src/groups.spec.ts libs/composition/package.json apps/content-service/src/app.module.ts pnpm-lock.yaml
git commit -m "feat(composition): wire status resolver and expiry worker into content

StatusModule adopts the { module, wiring } shape used by FeatureFlagsModule and
NotificationModule so the composition root can own its background worker, and
the content group now constructs the HttpSocialGraphResolver and registers the
expiry sweep.

The content group additionally declares valkey, for status rate limiting and
the Phase 2 tray cache. The architectural constraint runs the other way round
— realtime must stay Valkey-only so a content deploy cannot drop live sockets
— and that assertion in groups.spec.ts is left untouched."
```

---

## Task 10: Rate limiting on the mutating and expensive paths

**Files:**
- Modify: `libs/feature-status/src/status/status.service.ts`
- Modify: `libs/feature-status/src/status/status.module.ts`
- Modify: `libs/composition/src/groups.ts`
- Test: `libs/feature-status/test/unit/status.ratelimit.spec.ts` (create)

- [ ] **Step 1: Check the RateLimiter contract**

Run: `cat libs/cache/src/rate-limiter.ts`

The API is `allow(key, limit, windowSec): Promise<boolean>` — `true` while under the limit. It takes an `ioredis` `Redis`.

- [ ] **Step 2: Write the failing test**

Create `libs/feature-status/test/unit/status.ratelimit.spec.ts`:

```ts
import { StatusService } from '../../src/status/status.service';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';
import type { SocialGraphResolver } from '@velchat/feature-contracts';

function setup(allow: boolean) {
  const repo = {
    create: jest.fn(async () => undefined),
    findActive: jest.fn(async () => null),
  } as unknown as StatusRepository;
  const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const social = {
    relationship: jest.fn(async () => ({ isContact: true, isBlocked: false })),
  } as unknown as SocialGraphResolver;
  const limiter = { allow: jest.fn(async () => allow) };
  const svc = new StatusService(repo, events, social, { limiter, limits: { create: 30 } });
  return { svc, repo, limiter };
}

describe('StatusService rate limiting', () => {
  it('rejects a create once the per-account limit is exceeded', async () => {
    const { svc, repo } = setup(false);
    await expect(svc.post('author', { kind: 'text', text: 'ct' })).rejects.toThrow(/rate/i);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows a create while under the limit and keys the bucket per account', async () => {
    const { svc, repo, limiter } = setup(true);
    await svc.post('author', { kind: 'text', text: 'ct' });
    expect(repo.create).toHaveBeenCalled();
    expect(limiter.allow).toHaveBeenCalledWith(
      expect.stringContaining('author'),
      30,
      expect.any(Number),
    );
  });

  // Availability over enforcement for a non-authorization control: a Valkey outage must not stop
  // people posting. Authorization never degrades this way.
  it('allows the action when the limiter itself fails', async () => {
    const { svc, repo, limiter } = setup(true);
    limiter.allow.mockRejectedValue(new Error('valkey down'));
    await svc.post('author', { kind: 'text', text: 'ct' });
    expect(repo.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @velchat/feature-status test -- ratelimit`

Expected: FAIL — `StatusService` takes three constructor args.

- [ ] **Step 4: Implement**

In `libs/feature-status/src/status/status.service.ts`, add a minimal structural type (so `feature-status` need not depend on `@velchat/cache`), an optional fourth constructor parameter, and a guard.

```ts
/** Structural subset of RateLimiter — kept local so this lib does not depend on @velchat/cache. */
export interface StatusRateLimiter {
  allow(key: string, limit: number, windowSec: number): Promise<boolean>;
}

export interface StatusThrottle {
  limiter: StatusRateLimiter;
  limits?: { create?: number; view?: number; react?: number };
}

const WINDOW_SEC = 60;
const DEFAULT_LIMITS = { create: 30, view: 600, react: 120 };
```

Extend the constructor:

```ts
  constructor(
    private readonly repo: StatusRepository,
    private readonly events: StatusEvents,
    private readonly social: SocialGraphResolver,
    private readonly throttle?: StatusThrottle,
  ) {}
```

Add the guard method:

```ts
  /**
   * Abuse control, not authorization — so it fails OPEN. A Valkey outage must not stop people
   * posting. Authorization (§requireVisible) fails closed instead, and that asymmetry is the point.
   */
  private async guard(action: 'create' | 'view' | 'react', accountId: string): Promise<void> {
    if (!this.throttle) return;
    const limit = this.throttle.limits?.[action] ?? DEFAULT_LIMITS[action];
    try {
      if (!(await this.throttle.limiter.allow(`status:${action}:${accountId}`, limit, WINDOW_SEC))) {
        throw new TooManyRequestsError(`status ${action} rate limit exceeded`);
      }
    } catch (err) {
      if (err instanceof TooManyRequestsError) throw err;
      return; // limiter unavailable → allow
    }
  }
```

Check which error class the repo already uses for 429:

Run: `grep -rn "TooManyRequests\|429" --include="*.ts" libs/common/src/errors/ | head`

Use the existing class. If none exists, use `ValidationError` and note it, rather than inventing a new error type in this task.

Then call the guard as the first line of `post`, `view`, and `react`:

```ts
    await this.guard('create', actingAccountId);
```

Thread the throttle through `StatusModule` (a new optional `throttle` on `StatusModuleDeps`, passed to `StatusService`) and construct it in `contentGroup` from the now-available `infra.valkey`:

```ts
      const status = StatusModule.forRoot({
        logger,
        pg: postgres,
        eventBus,
        social,
        throttle: valkey ? { limiter: new RateLimiter(valkey.redis) } : undefined,
      });
```

Add `import { RateLimiter } from '@velchat/cache';` to `groups.ts` if absent.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @velchat/feature-status test`

Expected: PASS, every suite. Then `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add libs/feature-status/src/status/status.service.ts libs/feature-status/src/status/status.module.ts libs/composition/src/groups.ts libs/feature-status/test/unit/status.ratelimit.spec.ts
git commit -m "feat(feature-status): rate-limit create, view and react

Per-account fixed-window buckets on the existing RateLimiter. Deliberately
fails OPEN, unlike authorization: a Valkey outage must not stop people posting,
whereas an unobtainable authorization answer must never read as permission.
The limiter is a local structural type so feature-status does not take a
dependency on @velchat/cache."
```

---

## Task 11: Documentation

**Files:**
- Create: `docs/status/SECURITY.md`
- Modify: `docs/API-ENDPOINTS.md`

- [ ] **Step 1: Correct the endpoint reference**

Run: `sed -n '60,80p' docs/API-ENDPOINTS.md`

Line 68 currently reads `## realtime-service — /presence, /status (§B8)`. Split it: leave `/presence` under realtime-service, and add a Status section under content-service (find the content/media section and put it there). Update the Status rows to drop the removed parameters and show the new pagination:

```markdown
| POST | `/status` | Post a status (author = token). 24h server-set expiry |
| POST | `/status/:id/view` | Record a view (idempotent, audience-checked) |
| POST | `/status/:id/reactions` | React (emoji) |
| GET | `/status/:id/viewers?limit=&after=` | Viewer list, author only, cursor-paginated |
| GET | `/status/feed/:authorId` | An author's active statuses visible to the caller |
| DELETE | `/status/:id` | Soft-delete a status (author only) |
```

Add a note directly under the table:

```markdown
> Every Status endpoint derives the acting account from the verified access token. The former
> `userId` / `viewerId` / `requesterId` parameters are gone — they allowed any caller to act as
> another account. Paths are unchanged.
```

- [ ] **Step 2: Write the security document**

Create `docs/status/SECURITY.md` describing only what now exists: the threat table (each row an audited finding with its mitigation and the test that proves it), the fail-closed vs fail-open asymmetry between authorization and rate limiting, the E2EE boundary and what the server does and does not see, and the audience evaluation model. Keep every claim traceable to code — do not describe Phase 2.

Include this table:

```markdown
| Threat | Mitigation | Test |
|---|---|---|
| Delete another user's status | Ownership is in the `UPDATE` predicate; identity from the token | `status.service.spec.ts` — refuses to delete a status the caller does not own |
| Read another user's viewer list | Author-only check against the token | `status.service.spec.ts` — refuses the viewer list to anyone but the author |
| Read a private feed | Live audience evaluation via the fail-closed port | `status.service.spec.ts` — denies a non-contact reading an author feed |
| Post or react as another account | Identity from `@CurrentUser`, no identity field in any DTO | `status.service.spec.ts` — attributes the status to the acting account |
| Widen own audience via a forged contact list | `contacts` removed from the DTO; audience resolved server-side | `audience.spec.ts` — ignores a legacy materialised list |
| Blocked user views, reacts or reads a feed | Block checked in both directions before every mode | `status.service.spec.ts` — denies a blocked viewer |
| Directory outage grants access | Resolver fails closed | `social-graph.spec.ts` — fails CLOSED when the upstream errors |
| Read an expired or deleted status | Reads filter `state='active' AND expires_at > now()` | `status.service.spec.ts` — 404s on an expired status |
| Enumerate others' status ids | "Not yours" and "not found" are indistinguishable | `status.service.spec.ts` — delete of a foreign status 404s |
| Status ciphertext leaking to the bus | No content field in any payload | `status.service.spec.ts` — never puts content in the emitted event |
| Unbounded viewer list | Cursor pagination, clamped to 100 | `status.service.spec.ts` — viewer page shape |
| Status flooding | Per-account rate limits | `status.ratelimit.spec.ts` |
```

- [ ] **Step 3: Verify formatting**

Run: `pnpm format:check`

If it fails, run `pnpm format` (or `npx prettier --write` on the two files) and re-check.

- [ ] **Step 4: Commit**

```bash
git add docs/status/SECURITY.md docs/API-ENDPOINTS.md
git commit -m "docs(feature-status): document Status security model and correct API reference

API-ENDPOINTS listed Status under realtime-service, contradicting Part H and
matching the routing defect this phase fixed. Moves it to content-service,
drops the removed identity parameters, and documents cursor pagination.

SECURITY.md maps each audited finding to its mitigation and the test that
proves it, and records the deliberate asymmetry: authorization fails closed,
rate limiting fails open."
```

---

## Task 12: Final verification

- [ ] **Step 1: Full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check
```

Expected: all green. The only acceptable warnings are the two pre-existing `no-non-null-assertion` warnings in `feature-call` and `feature-auth`, which this work does not touch.

- [ ] **Step 2: Confirm no suppressions were introduced**

```bash
git diff main...HEAD -- '*.ts' | grep -nE '^\+.*(@ts-ignore|@ts-expect-error|eslint-disable|: any\b|as any)'
```

Expected: no output. If there is any, remove it and fix the underlying type properly.

- [ ] **Step 3: Confirm the feature-boundary rule still holds**

```bash
git diff main...HEAD -- 'libs/feature-status/**' | grep -nE "^\+.*from '@velchat/feature-(?!contracts)"
```

Expected: no output. `feature-status` may import `feature-contracts` and nothing else under `feature-*`.

- [ ] **Step 4: Confirm the audit's headline defects are actually closed**

Verify each by reading the code, not by assuming:

```bash
# No identity read from a body or query anywhere in the controller.
grep -nE "Query\('(viewerId|requesterId|userId)'\)|body\.(userId|viewerId)" libs/feature-status/src/status/status.controller.ts

# Every handler takes the token principal.
grep -c "@CurrentUser('accountId')" libs/feature-status/src/status/status.controller.ts

# The client-supplied contact list is gone.
grep -n "contacts" libs/feature-status/src/status/status.dto.ts
```

Expected: the first and third produce no output; the second prints `6`.

- [ ] **Step 5: Report**

Summarise: the defects closed, the files created and modified, the migration added, the endpoint surface before and after, test counts by category, and — honestly — what remains for Phase 2 (tray, cache, realtime fan-out, media pipeline, mute/archive, reaction aggregation, load tests, HLD/LLD). Do not describe Phase 2 work as done.

---

## Self-review notes

Checked against the spec:

- §3.1 routing → Task 1. §3.2 identity → Task 7 (DTOs) + Task 6 (service signature). §3.3 port and live audience → Tasks 2, 4, 6. §3.4 lifecycle/schema → Tasks 3, 5. §3.5 expiry worker → Task 8. §3.6 abuse controls → Tasks 9 (valkey in the group) and 10 (rate limiting). §3.7 E2EE → the no-content-in-event test in Task 6 and the payload change in Tasks 6 and 8. §4 failure semantics → fail-closed tests in Task 2, fail-open tests in Task 10. §5 test plan → Tasks 1, 2, 4, 6, 8, 10. §6 verification → Task 12.
- Idempotent create has no task, deliberately. It needs a `clientStatusId` plus a real uniqueness constraint, and half-built idempotency reads as a guarantee while providing none. The spec's §3.6 and its non-goals were amended to move it to Phase 2, so spec and plan now agree.
- Type consistency: `canView(post, viewerId, rel)` is used identically in Tasks 4 and 6. `relationship(owner, viewer)` matches between Tasks 2, 6, 9, 10. `markExpired`/`purgeAfterGrace`/`softDelete`/`viewersPage`/`listActiveByUser` are defined in Task 5 and used with those exact names in Tasks 6 and 8. `StatusExpiryOptions.graceHours` matches between Tasks 8 and 9. `statusPosted(statusId, userId, kind, expiresAt)` is consistent between Tasks 6 and its test.
- Config field names for the resolver's base URL and secret are the one genuine unknown; Task 9 Step 2 makes discovering them an explicit step rather than guessing a name.
