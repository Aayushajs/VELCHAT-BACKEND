# Status / Stories — Phase 1: Security & Reachability

**Date:** 2026-08-22
**Scope:** `libs/feature-status`, `libs/feature-contracts`, `libs/composition`,
`apps/edge-gateway`, `migrations/`
**Status:** design — approved for planning

---

## 1. Why this spec exists

An audit of the existing Status implementation (499 LOC in `libs/feature-status`, migration
`0007_status.sql`, 8 passing unit tests) found that the feature is simultaneously **unreachable in
the default deployment profile** and **completely unauthorized**. Both are shipped defects, not
missing features, so they are fixed before any new capability is added.

This spec covers Phase 1 only: make the Status API reachable, make every access decision
server-authoritative, and give the data model the lifecycle it needs. The tray, caching tier,
realtime fan-out, and media pipeline are Phase 2 and are explicit non-goals below.

### 1.1 Findings this spec closes

| # | Severity | Finding |
|---|---|---|
| F1 | S1 | `/status/*` is routed to the wrong runtime service and 404s under the default profile |
| F2 | S1 | Every endpoint takes the caller's identity from the request body/query — full IDOR + impersonation |
| F3 | S1 | The client supplies the author's contact list, so "My Contacts" is unenforceable |
| F4 | S1 | No blocked-user check on any access path |
| F5 | S2 | No lifecycle state; delete is a hard `DELETE` that cascades the viewer list away |
| F6 | S2 | Expiry is never actioned — `purgeExpired()` exists but nothing calls it |
| F7 | S2 | No rate limiting, despite `RateLimiter` already existing in the repo |

**F1 — wrong upstream.** [`routes.ts:40`](../../../apps/edge-gateway/src/gateway/routes.ts) maps
`/status` onto the logical service `PRESENCE`, and
[`topology.ts:26`](../../../apps/edge-gateway/src/gateway/topology.ts) maps `PRESENCE → REALTIME`
(dev port 3006). `StatusModule` is mounted only in `contentGroup`
([`groups.ts:182`](../../../libs/composition/src/groups.ts)) → content-service (3008).
`topology.ts:28` already declares `STATUS: 'CONTENT'`, but **no route uses the logical name
`STATUS`**, so that entry is dead code. Consequence: under `axis6` (the default) and `full13`, every
`/status/*` request lands on the process that has neither the controller nor a Postgres pool. It
works only under `SPLIT_PROFILE=mono`, where all groups share one process — which is why local
development never surfaced it. [`docs/API-ENDPOINTS.md:68`](../../API-ENDPOINTS.md) compounds the
confusion by documenting Status under realtime-service, contradicting architecture Part H.

**F2 — spoofable identity.** `@CurrentUser` exists in `libs/common` and is used correctly by
`feature-auth` and `feature-chat`. `feature-status` does not use it at all:

| Request | Consequence |
|---|---|
| `DELETE /status/:id?userId=<author>` | any caller deletes any user's status |
| `GET /status/:id/viewers?requesterId=<author>` | any caller reads the author's viewer list |
| `GET /status/feed/:authorId?viewerId=<member>` | any caller reads a private audience feed |
| `POST /status` with body `userId` | post a status as any user |
| `POST /status/:id/reactions` with body `viewerId` | react as any user |

**F3 — client-supplied audience.** `PostStatusDto.contacts: string[]` is the author's own contact
list, sent by the client and used server-side to resolve the audience. A client may claim anyone as
a contact, so the audience is attacker-chosen. `feature-user` already owns contacts and blocks
(`GET /users/:userId/contacts`), but no resolver is wired.

---

## 2. Non-goals (Phase 2)

Deferred deliberately, so Phase 1 stays reviewable:

- `GET /status/tray` and its Valkey cache, precomputation, and invalidation
- Realtime fan-out (`status.viewed`, `.expired`, `.deleted`, reaction events) and a realtime consumer
- Media integration: upload authorization, thumbnails, transcode, view-once blob deletion,
  `PROCESSING`/`FAILED` transitions
- Mute/unmute (`status_mutes`) and status archive — preference features that do not gate access
- Reaction aggregation, reaction removal, per-status audience update
- Idempotent create (`clientStatusId` + a uniqueness constraint) — see §3.6
- Load tests and the `docs/status/{HLD,LLD,PERFORMANCE,OPERATIONS}.md` set

Phase 1 does ship `docs/status/SECURITY.md` and corrects `docs/API-ENDPOINTS.md`, because both
describe what Phase 1 actually changes.

---

## 3. Design

### 3.1 Routing (F1)

Split the combined rule so the two prefixes resolve independently. Both are start-anchored, so
`/presence/status` (rich presence, correctly owned by realtime) is unaffected.

```ts
// apps/edge-gateway/src/gateway/routes.ts — replaces the single combined rule
R(/^\/presence(\/|$)/, 'PRESENCE', 3006),
R(/^\/status(\/|$)/,   'STATUS',   3008),
```

This activates the existing `STATUS: 'CONTENT'` mapping. No path changes, no client changes. A
regression test asserts `/status/x` resolves to the content upstream under `axis6` and `full13`, and
that `/presence/status` still resolves to realtime — the assertion that would have caught F1.

### 3.2 Identity from the verified token (F2)

Every endpoint takes its acting identity from `@CurrentUser('accountId')`. Paths and methods stay
byte-identical; the spoofable parameters are dropped from the DTOs and query strings. Clients
already send a bearer token, so no client change is required for correct callers — and the dropped
parameters were a vulnerability, not a feature.

| Endpoint | Before | After |
|---|---|---|
| `POST /status` | `body.userId` | token |
| `POST /status/:id/view` | `?viewerId` | token |
| `POST /status/:id/reactions` | `body.viewerId` | token |
| `GET /status/:id/viewers` | `?requesterId` | token |
| `GET /status/feed/:authorId` | `?viewerId` | token |
| `DELETE /status/:id` | `?userId` | token |

`PostStatusDto.userId`, `PostStatusDto.contacts`, and `ReactStatusDto.viewerId` are removed.

### 3.3 Server-side audience evaluation (F3, F4)

A new port in `libs/feature-contracts`, mirroring the existing `MembershipResolver` shape so the
6-service topology stays re-splittable and `feature-status` never imports `feature-user`:

```ts
/** The owner→viewer relationship, as far as status visibility is concerned. */
export interface SocialRelationship {
  /** `viewer` is in `owner`'s contact list. */
  isContact: boolean;
  /** Either party has blocked the other. */
  isBlocked: boolean;
}

export interface SocialGraphResolver {
  /**
   * Resolve how `viewer` relates to `owner`. Authorization → fails CLOSED: an unobtainable
   * answer resolves to `{ isContact: false, isBlocked: true }`, never to permission.
   */
  relationship(owner: string, viewer: string): Promise<SocialRelationship>;
}
```

One method rather than two, because a single upstream call answers most of it. `GET /users/:owner/contacts`
returns `Contact { contact_user_id, display_name, blocked }[]`, so the owner's list yields both
whether the viewer is a contact and whether the *owner* blocked the viewer. Only the reverse
direction needs a second call, `GET /users/:viewer/contacts/:owner/blocked` → `{ blocked }`. Both
directions matter: an author who blocked a viewer must not be visible to them, and a viewer who
blocked the author must not receive their statuses.

Two integration details that are easy to get wrong:

- **Responses are enveloped.** `ResponseInterceptor` wraps every JSON response as
  `{ success, statusCode, message, data }`, so the resolver must read `body.data`, not the body.
  (`HttpMembershipResolver` reads `body.members` with an array fallback and does not unwrap the
  envelope — noted as a separate pre-existing concern, not changed here.)
- **`listContacts` is the only available primitive** for a contact check; there is no
  `GET /users/:owner/contacts/:viewer` existence endpoint. Phase 1 therefore fetches the owner's
  list to answer one question. That is acceptable for correctness now and is exactly what Phase 2's
  per-owner cache makes cheap; adding a narrow existence endpoint to `feature-user` is a Phase 2
  option.

`HttpSocialGraphResolver` copies `HttpMembershipResolver`'s hardening exactly: `http(s)`-only
base-URL validation (so a mis-set env var cannot become an SSRF primitive), `x-velchat-internal`
shared secret, `redirect: 'error'`, an abort timeout, and in-flight request coalescing so a cold
cache cannot fan one miss into hundreds of upstream calls. Base URL and secret come **from
configuration only, never from a request**.

`relationship` fails closed. This differs from `MembershipResolver.members()`, which fails *empty*
because it drives best-effort live fan-out with a durable catch-up behind it. Here there is no
backstop: an unobtainable answer must not read as permission.

Audience becomes a **rule evaluated at read time** rather than a materialized snapshot:

| Mode | Decision (after the block check below) |
|---|---|
| `only` | `viewer ∈ audience.list` |
| `except` | `isContact ∧ viewer ∉ audience.list` |
| `contacts` | `isContact` |

`isBlocked` is checked first on every path and denies regardless of mode — including `only`, so an
explicitly listed viewer who has since been blocked loses access. The author is always allowed to
read their own status.

Three reasons to evaluate rather than snapshot: contact removals and new blocks take effect
immediately instead of being frozen at post time; a 1024-contact author no longer writes a
1024-element JSONB blob per status that is re-read and linearly scanned on every access; and the
stored rule stays small and honest about intent.

Existing rows migrate without a rewrite. A `contacts`-mode row currently carries a materialized
list; under evaluation that list is simply ignored in favour of the live check, which is strictly
more correct. `only`/`except` rows keep reading `audience.list`, whose contents are already the
small explicit list the author chose. The migration is therefore expand-only.

### 3.4 Lifecycle and schema (F5)

New migration `0023_status_lifecycle.sql`, expand-only:

```sql
ALTER TABLE status_posts
  ADD COLUMN IF NOT EXISTS state      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE status_posts
  ADD CONSTRAINT status_state_chk
  CHECK (state IN ('creating','processing','active','failed','deleted','expired'));

CREATE INDEX IF NOT EXISTS status_owner_active_idx
  ON status_posts (user_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS status_expiry_sweep_idx
  ON status_posts (state, expires_at);
CREATE INDEX IF NOT EXISTS status_views_cursor_idx
  ON status_views (status_id, viewed_at);
```

Phase 1 transitions only `active → deleted` and `active → expired`. `creating`, `processing`, and
`failed` are in the constraint now so the Phase 2 media pipeline needs no second migration; they are
unreachable until then, and the spec says so rather than implying they work.

`status_views_cursor_idx` supports cursor pagination over the viewer list. The existing primary key
is `(status_id, viewer_id)`, which cannot serve an ordered scan by `viewed_at`.

Delete becomes a soft delete: `state='deleted'`, `deleted_at=now()`. The hard `DELETE` cascaded
`status_views` away, destroying the author's viewer data and any audit trail at the moment of
deletion.

**Read-time enforcement is the correctness guarantee.** Every read filters
`state = 'active' AND expires_at > now()`. Expiry and deletion are therefore enforced even if the
sweep worker is down for a week; the worker exists for cleanup and events, never for correctness.
This is what makes F6's fix crash-safe.

### 3.5 Expiry worker (F6)

An overlap-guarded interval worker matching `FlagScheduleWorker`'s established shape (`start()` /
`stop()`, a `running` flag, per-item `try/catch`, a tick that swallows errors so a cold database
cannot crash the process). Two stages:

1. **Mark** — `UPDATE status_posts SET state='expired' WHERE state='active' AND expires_at <= now()`
   returning ids, then emit `status.expired` per row. Idempotent by construction: the predicate
   only matches rows not yet expired, so a re-run is a no-op and a crash mid-pass loses nothing.
2. **Purge** — hard-delete rows in `expired`/`deleted` older than a configurable grace window
   (`STATUS_PURGE_GRACE_HOURS`, default 24). The grace window is what lets Phase 2 do asynchronous
   media cleanup and status archiving without racing the purge.

`StatusModule.forRoot` changes to return `{ module, wiring }` — the pattern `FeatureFlagsModule` and
`NotificationModule` already use — so the composition root can push the worker onto `m.workers`.

### 3.6 Abuse controls (F7)

`contentGroup.need` gains `'valkey'`. The binding architectural constraint is that
*realtime*-service stays Valkey-only (a Postgres pool in the socket process would make every content
deploy drop live connections); nothing prohibits Valkey in the content process, and Phase 2's tray
cache needs it regardless. `libs/composition/src/groups.spec.ts` asserts per-group datastore
declarations and is updated in the same change.

- **Rate limiting** via the existing `RateLimiter.allow(key, limit, windowSec)`, keyed per account
  per action, on create / view / react. Limits are configuration, not literals.

Rate limiting fails **open**, which is the deliberate inverse of §3.3. It is an abuse control, not
an authorization control: a Valkey outage must not stop people posting, whereas an unobtainable
authorization answer must never read as permission.

Idempotency on create is **deferred to Phase 2**, not because it does not matter but because doing
it properly is its own change: it needs a `clientStatusId` on the DTO, a uniqueness constraint to
make the guarantee real rather than advisory, and a decision about what a retry returns. Half-built
idempotency reads as a guarantee while providing none, so Phase 1 leaves it out rather than
gesturing at it. View and reaction writes are already idempotent at their primary keys, so the
exposure is limited to a double-tapped publish creating two statuses — visible and self-correcting,
unlike a silent authorization hole.

### 3.7 E2EE boundary

The existing shape is already correct — `text` holds ciphertext for personal statuses and the server
never parses it — but nothing *enforces* it. Phase 1 adds the enforcement that makes the guarantee
testable:

- `status.posted` carries **no content fields**. A test asserts the emitted payload has no `text`,
  `caption`, or `bg`, so content cannot leak into the event bus, its consumers, or a replay.
- Status content never enters a log line, span attribute, metric label, or error message. Errors
  reference `status_id` only.
- The `audience.list` remains server-visible metadata by design (the server must evaluate access);
  this is stated explicitly rather than left implicit.

---

## 4. Failure semantics

| Dependency | Behaviour |
|---|---|
| `SocialGraphResolver` unreachable | **Deny.** Authorization with no answer is not permission. |
| Valkey unreachable | Rate limiting degrades open (§3.6); authorization and reads are unaffected because neither consults the cache. Correctness never depends on Valkey. |
| Event bus unreachable | The status is already persisted; the publish failure is logged. Reads do not depend on the event. |
| Expiry worker down | Expiry is still enforced at read time (§3.4). Only cleanup lags. |
| Postgres unreachable | The endpoint fails. Postgres is the source of truth; there is no degraded mode that could invent an access decision. |

---

## 5. Test plan

**Security regression — one test per bypass in F2/F3/F4**, each asserting the *old* attack now
fails:

- delete another user's status → `403`
- read another user's viewer list → `403`
- read a private feed as a non-member → `403`
- post as another user → identity comes from the token, not the body
- react as another user → identity comes from the token
- a blocked viewer is denied on view, react, and feed
- a client-claimed contact list cannot widen the audience (the field no longer exists)
- resolver timeout/error → denied, never allowed (fail-closed, asserted directly)

**Unit** — the audience matrix across all three modes × contact/non-contact/blocked; lifecycle
transitions; expired and soft-deleted statuses are unreadable; the expiry mark is idempotent across
repeated ticks; `status.posted` contains no content.

**Routing** — `/status/*` → content upstream under `axis6` and `full13`; `/presence/status` → realtime.

**Regression** — the 8 existing tests must stay green, adjusted only where they assert the removed
client-supplied parameters. Full repo suite green before completion.

---

## 6. Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus the migration applied against a real
Postgres and the new tests passing. No `any`, `@ts-ignore`, or `eslint-disable` added.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Adding Valkey to content-service widens its dependency surface | Justified by rate limiting now and the tray cache next; correctness never depends on it (§4) |
| A per-read social-graph call adds latency to feed reads | Phase 1 accepts it for correctness; Phase 2's cache (with `contact.removed`/`blocked` events for invalidation) removes it from the hot path |
| `contact.removed` / `contact.blocked` events do not exist | Not needed in Phase 1 because evaluation is live, not cached. They become a Phase 2 prerequisite and are called out there. |
| Callers relying on the spoofable parameters break | Those callers were exploiting the vulnerability; paths are unchanged for correct callers |
