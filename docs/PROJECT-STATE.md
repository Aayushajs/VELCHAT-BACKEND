# Project state — handoff

A running record of what is in flight, what was decided and why, and what is known-broken. Read
this first if you are picking the work up cold; it is meant to replace having to reconstruct
context from git history.

**Last updated:** 2026-08-23 · branch `dev`

---

## Where things stand

Two threads are in flight. One is finished, one is partly done.

| Thread | State |
| --- | --- |
| Status/Stories Phase 1 — security & reachability | **Complete.** All 12 planned tasks done. |
| CI/CD + deployment | **Written, never executed.** Docker was unavailable locally, so the first CI run is the first real test. |

Repo gates are green as of the last commit: `pnpm typecheck` 62/62, `pnpm build` 34/34,
`pnpm test` 58/58, lint clean apart from two pre-existing `no-non-null-assertion` warnings in
`feature-call` and `feature-auth` that predate this work.

---

## Thread 1 — Status/Stories Phase 1

**Spec:** `docs/superpowers/specs/2026-08-22-status-security-reachability-design.md`
**Plan:** `docs/superpowers/plans/2026-08-22-status-security-reachability.md` (12 tasks)

An audit of `libs/feature-status` found the feature was simultaneously unreachable and completely
unauthorized. Three findings dominated:

1. **The whole API 404'd under the default profile.** `routes.ts` mapped `/status` to the logical
   service `PRESENCE`, which `topology.ts` maps to realtime-service — but `StatusModule` is mounted
   only in the content group. `topology.ts` already had `STATUS: 'CONTENT'`, dead because no route
   referenced it. It worked only under `SPLIT_PROFILE=mono`, where all groups share one process,
   which is why local development never surfaced it.
2. **Every endpoint was spoofable.** Identity came from the request body or query, never the token,
   so `DELETE /status/:id?userId=<author>` deleted anyone's status and
   `GET /status/:id/viewers?requesterId=<author>` read anyone's viewer list.
3. **The client supplied the privacy audience.** `PostStatusDto.contacts` was the author's own
   contact list, sent by the client, so "My Contacts" was attacker-chosen.

### Done (tasks 1–7 + part of 9)

| Commit | What |
| --- | --- |
| `ded3478` | `/status` routed to content-service; regression test under `axis6` and `full13` |
| `fe3b3a9` | `SocialGraphResolver` port in `feature-contracts`, fail-closed, 19 tests |
| `73980ff` | Migration `0023`: lifecycle `state`, `deleted_at`, three indexes |
| `3470e07` | `canView` replaces the snapshot audience model |
| `f877b5d` | State-filtered reads, soft delete, cursor-paginated viewers, two-stage expiry queries |
| `9a4307a` | Service takes the acting identity as a parameter and authorizes live |
| `86094ad` | Controller uses `@CurrentUser`; composition wires the resolver |
| `ce1062f` | Expiry worker, per-account rate limits, `docs/status/SECURITY.md`, API-doc correction |

### Not done

**Phase 2, entirely.** None of it is security-critical; Phase 1 closed the exploitable holes.

- The tray endpoint (`GET /status/tray`) and its Valkey cache. This is the hottest path in the
  product and does not exist yet — a client building a tray today must call
  `GET /status/feed/:authorId` once per author.
- Realtime fan-out. `status.posted` and `status.expired` are published but **nothing consumes
  them**, so there is no live ring and no live removal.
- Media pipeline: upload authorization, thumbnails, transcode, view-once blob deletion, and the
  `processing` / `failed` lifecycle states (already allowed by the `0023` CHECK constraint, so no
  second migration is needed).
- Mute/archive (`status_mutes`, `status_archive` from §B8 — neither table exists), reaction
  aggregation and removal, per-status audience update.
- Idempotent create, load tests, HLD/LLD documents.

A per-viewer cost worth knowing before building the tray: `SocialGraphResolver.relationship()`
makes **two** upstream calls, and its in-flight coalescing keys on the owner, so it dedupes the
contacts lookup but not the reverse block probe. Resolving N viewers of one author therefore costs
`1 + N` calls. The tray will want either a batch endpoint on the directory or a short-TTL cache.

### Decisions worth not re-litigating

- **Audience is evaluated live, not snapshotted.** Contact removals and new blocks take effect
  immediately, and a 1024-contact author no longer writes a 1024-element JSONB blob per status.
  Legacy rows carrying a materialised list under `contacts` mode have it ignored in favour of the
  live check, which is strictly more correct, so the migration needed no data rewrite.
- **Authorization fails closed; rate limiting fails open.** An unobtainable authorization answer
  must never read as permission. A Valkey outage must not stop people posting. That asymmetry is
  deliberate — do not "fix" it into consistency.
- **`ViewersQueryDto` validates with `class-validator`, not `class-transformer`.** The latter is
  not a dependency of the package and CLAUDE.md requires asking before adding one.
- **Idempotent create was deferred to Phase 2 on purpose.** It needs a `clientStatusId` and a real
  uniqueness constraint; idempotency that is not backed by a constraint reads as a guarantee while
  providing none.

---

## Thread 2 — CI/CD

See `docs/CI-CD.md` for the full runbook. In short: `dev` → Render (builds from source),
`main` → Azure (versioned, signed images from GHCR). Version is derived from Conventional Commits,
so a merge cuts a release with no second PR.

**Nothing here has run yet.** Docker was unavailable on the development machine, so the workflows
and the new `docker/velchat-mono.Dockerfile` have never been executed. Expect the first run to need
fixing, and treat a first-run failure as ordinary rather than as evidence of a deeper problem.

### Before the first deploy can work

1. Set the repository secrets listed in `docs/CI-CD.md` → *Required GitHub secrets*.
2. Create `~/velchat.env` on the Azure VM from `deploy/azure/.env.example`.
3. Point DNS at the VM before the first deploy, or Caddy cannot get a certificate.
4. Run migrations against the managed Postgres once.

---

## Known issues found along the way, not yet fixed

Each was found while doing something else and deliberately not fixed in place. None is caused by
the work above.

- **`HttpMembershipResolver` never unwraps the response envelope.**
  `libs/feature-contracts/src/membership.ts` reads `body.members`, but `ResponseInterceptor` wraps
  every JSON response as `{ success, statusCode, message, data }`. Against a live Nest upstream
  that resolves `undefined` and falls through to `[]`, so `members()` returns empty and
  `isMember()` returns false for everyone. It would present as missing realtime fan-out and
  silently rejected receipts and typing, not as an error. Worth confirming against a running
  service first, then fixing with a test. The newer `HttpSocialGraphResolver` does unwrap correctly.
- **Spec files are type-checked by nothing.** Every package's `tsconfig.json` excludes
  `**/*.spec.ts` and ts-jest runs transpile-only, so a type error in a test only surfaces at
  runtime.
- **Six Dockerfiles use `pnpm install --frozen-lockfile=false`,** which lets the dependency graph
  drift at build time. We sign these images and publish an SBOM for them; both assume the opposite.
  `docker/velchat-mono.Dockerfile` uses `--frozen-lockfile` — the other six should follow, ideally
  once CI has proven the lockfile is clean.
- **Each image rebuilds the whole monorepo.** One shared base image with seven thin images on top
  would cut release build time roughly sevenfold.
- **`UPSTREAM_STATUS` is undocumented** in the env contract. Harmless under `axis6`; a `full13`
  deployment needs it.

---

## Working agreements

- Commits are **author-only** — no `Co-Authored-By` trailer.
- Conventional Commits, and the scope must come from the commitlint enum (`feature-status`,
  `feature-contracts`, `composition`, `edge-gateway`, `database`, `docs`, `ci`, …). `status` is not
  a valid scope.
- The husky pre-commit hook runs repo-wide lint and `format:check`, so a commit can take **over two
  minutes**. Give it a long timeout rather than assuming it hung, and never pass `--no-verify`.
- A `libs/feature-*` library must not import another `libs/feature-*` library. Cross-feature calls
  go through a port in `libs/feature-contracts`, wired by the composition root.
- `realtime-service` stays Valkey-only. A Postgres pool in that process means every content deploy
  drops live WebSocket connections.
