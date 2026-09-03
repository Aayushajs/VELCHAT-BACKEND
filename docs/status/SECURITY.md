# Status / Stories — security model

What the server enforces for status content, and which test proves each claim. Everything here
describes code that exists; Phase 2 work is out of scope and is not described.

---

## The audit this closed

`libs/feature-status` shipped with the feature simultaneously unreachable and unauthorized. Three
findings dominated:

1. **The API was unreachable under the default deployment profile.** The edge route mapped
   `/status` onto the logical service `PRESENCE`, which the topology maps to realtime-service — but
   `StatusModule` is mounted only in the content group. Every request reached a process with no
   controller and no Postgres pool. It appeared to work only under `SPLIT_PROFILE=mono`, where all
   groups share one process.
2. **Every endpoint took its caller's identity from the request.** `userId`, `viewerId` and
   `requesterId` came from the body or query string rather than the verified token.
3. **The client supplied the privacy audience.** `PostStatusDto.contacts` was the author's own
   contact list, sent by the client and used server-side to resolve "My Contacts".

---

## Threats and mitigations

| Threat | Mitigation | Test |
| --- | --- | --- |
| Delete another user's status | Ownership is in the `UPDATE` predicate, and identity comes from the token | `refuses to delete a status the caller does not own` |
| Read another user's viewer list | Author-only check against the token | `refuses the viewer list to anyone but the author` |
| Read a private feed | Audience evaluated live via the fail-closed port | `denies a non-contact reading an author feed` |
| Post or react as another account | `@CurrentUser`; no identity field exists in any DTO | `attributes the status to the acting account, not to any supplied field` |
| Widen your own audience with a forged contact list | `contacts` removed from the DTO; audience resolved server-side | `stores the audience RULE, not a materialised member list` |
| A stale materialised audience keeps an ex-contact in | Legacy snapshot ignored in favour of the live check | `ignores a legacy materialised list under contacts mode` |
| Blocked user views, reacts, or reads a feed | Block checked in both directions before every mode | `denies a blocked viewer on view, react and feed` |
| A directory outage grants access | Resolver fails closed | `denies when the social graph cannot be reached (fail closed)` · `fails CLOSED when the upstream errors` |
| Read an expired or deleted status | Reads filter `state = 'active' AND expires_at > now()` | `404s on an expired or missing status rather than leaking existence` |
| Enumerate other people's status ids | "Not yours" and "not found" are indistinguishable | `refuses to delete a status the caller does not own` |
| Client pins a status open forever | Expiry computed from server time only | `sets a 24h server-authoritative expiry` |
| Status ciphertext leaking onto the event bus | No content field in any payload | `never puts status content in the emitted event` |
| Unbounded viewer list | Cursor pagination, clamped to 100 | `gives the viewer list to the author` |
| Status flooding | Per-account rate limits on create, view and react | `rejects a create once the per-account limit is exceeded` |
| A mis-set env var turning the resolver into an SSRF primitive | Base URL validated as `http(s)` at construction | `rejects a non-http base URL so a mis-set env var cannot become an SSRF primitive` |
| Internal secret leaking to another host | `redirect: 'error'` on every internal call | `sends the internal shared secret` |
| Path traversal through an account id | Ids are URL-encoded into the path | `encodes ids so a caller-supplied id cannot walk the path` |

---

## Authorization

One decision function, `canView`, is used by every read path, so no endpoint can forget the check.
It takes the viewer's **live** relationship to the author rather than a set materialised at post
time, which means removing a contact or blocking someone takes effect immediately.

| Mode | Allowed when |
| --- | --- |
| `contacts` | the viewer is a contact of the author |
| `except` | the viewer is a contact **and** is not on the exclusion list |
| `only` | the viewer is on the list — being a contact is not required, the list is explicit intent |

A block denies under **every** mode, including an explicit `only` list: being named earlier does
not survive being blocked later. The author always sees their own status.

### The fail-closed / fail-open asymmetry

This is deliberate and should not be tidied into consistency.

- **Authorization fails closed.** `SocialGraphResolver` answers `{ isContact: false, isBlocked: true }`
  on any upstream error, timeout, or non-2xx. An answer that could not be obtained must never read
  as permission. In production without `INTERNAL_API_SECRET`, the composition root substitutes a
  deny-all resolver and logs a warning rather than starting permissive.
- **Rate limiting fails open.** A Valkey outage must not stop people posting. A quota is an abuse
  control, not a correctness requirement.

This mirrors the existing `MembershipResolver`, whose `members()` fails *empty* because it drives
best-effort fan-out with a durable cursor catch-up behind it. Status has no such backstop, so it
denies instead.

---

## The E2EE boundary

Personal status content is ciphertext the server stores and never parses.

- `text` and `caption` are opaque. Nothing on the server reads, indexes, or transforms them.
- **No event carries content.** `status.posted` and `status.expired` contain only ids, kind and
  timestamps. Content therefore cannot reach the event bus, a consumer, or a replay. There is a
  test asserting the emitted payload does not contain the content it was given.
- Errors reference `status_id` only; content never enters a log line, span attribute, or metric
  label.

What the server *does* see, by design: who posted, when, of what kind, and the audience rule —
including any explicit account list for `only` and `except`. It must, in order to evaluate access.
This is metadata, and it is stated here rather than left implicit.

---

## Lifecycle

Delete is a soft delete: the row moves to `state = 'deleted'` with `deleted_at` set, so the
author's viewer data survives and the deletion is auditable. The previous hard `DELETE` cascaded
`status_views` away.

**Expiry is enforced at read time, not by the worker.** Every read filters
`state = 'active' AND expires_at > now()`. The sweep worker exists to emit `status.expired` and to
reclaim rows; it is never load-bearing for correctness, so a crash or a week of downtime delays
cleanup without ever exposing expired content. Its marking pass is idempotent — the predicate
matches only rows still active — and uses `FOR UPDATE SKIP LOCKED` so it is safe to run from more
than one replica.

---

## Not covered here

Rate limits are per account and per action, not per IP; gateway-level limiting is a separate layer.
Tenant scoping (§G6) does not apply to personal status, which has no tenant. Phase 2 concerns —
the tray cache, realtime fan-out, media authorization, and idempotent create — are not implemented
and are deliberately absent from this document.
