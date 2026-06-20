# VelChat — Claude Code Prompt Pack (Backend Only)

**Use this with:** the architecture doc at `docs/VelChat-Architecture.md` (v2.5+), with `.claude/CLAUDE.md` and `.claude/agents/` (Part E) already set up.

**How to use:**
1. Run `BOOT-0` once to set up the repo.
2. Then run `P0 → P10` in order. Each phase has clear exit criteria.
3. Don't paste the architecture doc into prompts — Claude Code already has it via `CLAUDE.md`. Refer by section (`§B2`, `§A11`, etc.).
4. Always end with the global DoD line. The subagent roles already enforce most rules.
5. After each phase, run `OPS-3 code-audit` before moving on.

**Token-saving rules baked into these prompts:**
- Short prompts, doc references over re-pasting.
- "Use the `<role>` subagent" → loads role from `.claude/agents/<role>.md` (its own context).
- Phases are vertical slices, not full features at once.
- "Definition of Done" is one line, not a checklist re-pasted everywhere.

---

## BOOT-0 — Repository bootstrap (run ONCE, in main session, no subagent)

```
Bootstrap a production NestJS + TS backend monorepo for VelChat per @docs/VelChat-Architecture.md.

Stack: pnpm workspaces + Turborepo, NestJS, TypeScript strict, gRPC + protobuf (buf), Kafka client (kafkajs), Mongo (mongoose, sharded ready), Postgres (Prisma OR Drizzle — pick one and justify in 2 lines), Valkey (ioredis), OpenSearch client, MinIO (S3 SDK), OpenTelemetry, pino logs, Helm + Dockerfiles, Buildah/Kaniko-friendly. Test stack: Jest + supertest + testcontainers. Free/OSS only.

Create exactly the monorepo from §D3:
- apps/: api-gateway, realtime-gateway, auth-service, user-service, chat-service, group-channel-service, presence-service, notification-service, media-service, search-service, call-service, automation-service, ai-service (skeletons for all 13; only NestJS scaffold + health/ready + OTel + Kafka + DB clients wired; no business logic yet)
- packages/: proto (buf workspace), shared-types (generated), shared-utils (logger, tracer, kafkaClient, idempotency, tenant-context (ALS), authz guards, errors), config (zod env schema), crypto (libsignal wrapper stub)
- deploy/: helm/ per service, argocd/ app-of-apps, k8s/ base manifests
- infra/: terraform stubs (cluster only), migrations/

Also create:
- .claude/CLAUDE.md (the master from §E1, exact contents)
- .claude/agents/*.md for all 8 roles (§E2–§E9, exact contents)
- .github/ OR woodpecker config for CI: lint, typecheck, test, build, Trivy, cosign, SBOM
- Conventional Commits config (commitlint + husky)
- A docker-compose.dev.yml with Postgres, Mongo, Valkey, Kafka (KRaft), OpenSearch, MinIO so a dev can run integration tests locally

Constraints:
- TS strict: true, no any, no @ts-ignore.
- Every service has /health, /ready, OTel HTTP/gRPC instrumentation, structured pino logs (no PII), Prom metrics endpoint.
- No secrets in code. Read from env via zod schema; document env in each service's README.
- Shared tenant-context (AsyncLocalStorage) + an interceptor wired in api-gateway and a Kafka consumer base class that establishes tenant context from event envelope (§G6, §G7).

Definition of Done: `pnpm i && pnpm build && pnpm test` green; `docker compose up` brings dev infra; each service responds on /health; one example service emits a sample Kafka event with the standard envelope (§G7); one example service sets RLS GUC + tenant context.
```

---

## P0 — Platform foundations (no features yet)

```
Use the `platform-devops-engineer` subagent.

Implement Phase 0 from §F. Specifically:
1. Helm charts for all 13 services with HPA, PDB, anti-affinity, readiness/liveness, resource requests/limits.
2. ArgoCD app-of-apps wired to deploy/argocd/.
3. Operators (or Helm) for Postgres (CloudNativePG), MongoDB (community operator), Valkey (cluster), Kafka (Strimzi KRaft mode), OpenSearch, MinIO.
4. Linkerd mTLS install + NetworkPolicy default-deny + explicit allow per service.
5. Observability: Prometheus + Grafana + Loki + Tempo + GlitchTip + Alertmanager via Helm; default dashboards for NestJS + Kafka + each DB; SLO burn alerts.
6. cert-manager + Let's Encrypt ClusterIssuer; Sealed Secrets controller.
7. Schema registry (Apicurio OSS) + buf CI compat check set to FULL_TRANSITIVE per §G7.

Constraints: free/OSS only; no paid SaaS; secrets via Sealed Secrets only.

DoD: ArgoCD shows all apps Healthy on a k3s cluster; `kubectl get pods -n velchat-prod` all Running; Grafana shows traces+logs+metrics from the example service emitting a sample event; CI rejects a deliberately incompatible proto change.
```

---

## P1 — Auth service (DAPT, Reverse-OTP)

```
Use the `security-e2ee-engineer` subagent (primary), with `backend-engineer` for non-crypto code.

Implement auth-service per §A14.1 + §B2 + flow C1.

Scope:
- Schemas exactly per §B2.1 (accounts, identifiers, devices, passkeys, refresh_tokens, signal_prekeys, totp_secrets, recovery_backup_codes, auth_audit).
- DAPT trust waterfall: device-key challenge, passkey (WebAuthn via @simplewebauthn/server), approve-on-trusted-device (QR + signed approval), email magic-link (Postfix SMTP via nodemailer), Reverse-OTP via an Asterisk/FreeSWITCH HTTP webhook stub (define the contract; full PBX wiring is platform task).
- Reverse-OTP anti-spoof rules from §B2.2: CLI match, token+time-window bound to session, real-mobile origination check (stub list of VoIP ranges), Play Integrity/App Attest verdict verification.
- Tokens: RS256/JWKS access (~15m), opaque rotating refresh with reuse-detection + DPoP binding (cnf_jkt). Refresh-rotation tests must include reuse-detection.
- Identity = account_id (UUIDv7); phone/email are identifiers. Number-change per §B2.6 (C17). Recovery per §B2.7 (C18) — multi-factor + delay + notify-all.
- Keycloak OIDC integration for enterprise SSO (configuration + login flow only, not the Keycloak install itself).
- Kafka events: user.created, device.added, device.revoked, identifier.changed (envelope per §G7, tenant_id where applicable).
- Tenant context middleware + RLS GUC set per request (§G6).

Tests required (Jest + testcontainers, real Postgres + Valkey):
- Reverse-OTP happy path + each anti-spoof rejection.
- Token rotation + reuse-detection revokes the family.
- New-device link via passkey AND via approve-on-trusted-device.
- Number change: precondition checks, atomic re-point, recycled-number safety.
- Recovery: 2-factor delay path; cooling-off; full session revocation on completion.
- DAPT waterfall: each fallback step works when the prior fails.
- Each §D4 row that touches auth has at least one test.

DoD: all flows in §B2 + C1/C6/C17/C18 implementable end-to-end against the service; ≥85% line coverage on auth-service; gRPC + REST endpoints documented; OTel traces for every flow.
```

---

## P2 — Chat service + realtime-gateway + E2EE 1:1 (the core)

```
Use the `backend-engineer` and `realtime-engineer` subagents (you may delegate within the prompt).

Implement Phase 2 per §B4, §B5, §B9, flow C2 + C16. Also wire the E2EE prekey directory consumer side (libsignal envelope is opaque to server).

chat-service:
- Message schema per §B4.1 in Mongo (sharded by conversation_id, hashed). Indexes per §A10.2.
- Per-conversation monotonic seq counter in Valkey with periodic Postgres checkpoint.
- SendMessage hot path exactly per §B4.2: validate → dedupe (client_msg_id) → assign seq → persist → emit message.sent → ACK. Sync work minimal.
- Receipts (delivered, read up-to-seq), edits/deletes/reactions/pins per §B15.
- Recent-N message cache in Valkey per conversation.
- Idempotency layer: every consumer uses event_id dedup (§G7).
- E2EE-aware: content stored as ciphertext blob for personal conversations; never tries to read it.

realtime-gateway:
- WebSocket fabric per §B9 — connection registry in Valkey, pod pub/sub, heartbeat, graceful drain.
- Inbound: typing, read-acks, presence pings.
- Outbound: consumes message.*, presence.*, call.*; routes via conn:{user} → pod:{pod_id}.
- Backpressure: bounded send queue; coalesce/drop ephemeral only; never drop durable.
- Reconnect with sync_cursor replays missed seq (C16 — no-loss guarantee).
- Resume tokens for cheap reattach vs full sync (§G3-3).

Tests:
- Two test clients exchange ciphertext messages; verify zero plaintext ever hits the server (assert on Mongo + logs).
- Offline recipient: sender pushes, then recipient reconnects; replay restores all missed.
- Force a socket drop mid-flow; reconnect-without-loss test passes.
- Backpressure test: slow consumer doesn't lose durable messages.
- Idempotency: duplicate client_msg_id returns existing message.
- Decryption-failure resend protocol stub per §G1-1 (server side: accept resend-request, route to sender).

Load test (k6) — separate test job, not in unit run:
- 10k concurrent sockets on one realtime-gw pod; reconnect storm jittered backoff works.

DoD: send-to-deliver p99 < 1s for online recipients in a local cluster; tests above green; OTel trace from gateway → chat-service → kafka → realtime-gw to recipient.
```

---

## P3 — Groups, channels, multi-device fan-out, sender-keys

```
Use the `backend-engineer` and `security-e2ee-engineer` subagents.

Implement Phase 3 per §B7 + §A14.3 (groups) + §B5 (multi-device) + §G1-2 (epoch SKDM recovery) + §G1-3 (versioned device list with key transparency).

group-channel-service:
- conversations + conversation_members + communities per §B7 schemas.
- DM conversation_id deterministic from sorted account_id pair.
- Group up to 1024 members; admin/announcement/broadcast semantics.
- Membership ops emit channel.member.added/removed + group.epoch.bumped (§G1-2).
- Versioned device-list epoch per account (§G1-3) emitted on every device add/revoke; senders bind encryption to current epoch + re-fan-out on epoch change.

Multi-device:
- Sender-side per-device fan-out routing in chat-service (existing message store, multi-recipient envelope).
- SKDM queue per recipient-device + skdm-request handler (§G1-2 state machine).
- New-device history bundle relay path (server transports E2EE-opaque bundles between devices of the same user).

Key transparency:
- Append-only Merkle log of device-list updates (one log per region; small CONIKS-style). Service exposes proofs to clients; clients audit.

Tests:
- Group epoch rotates on member removal; removed member can't decrypt new-epoch ciphertext in a test harness.
- Offline device rejoins after epoch change → skdm-request → recovered.
- Versioned device list: server alone cannot add a usable device (approval-gated); transparency proof verifiable.
- Simultaneous device-link race: serialization via per-account lock; only one outcome valid.

DoD: G1-1, G1-2, G1-3, G1-4 scenarios reproducible in tests; all pass. No permanent undecryptability path in normal operation.
```

---

## P4 — Media + Status + E2EE Backup

```
Use the `backend-engineer` subagent.

Implement Phase 4 per §B11, §B8 (status), §A4.1 chat-backup, flows C10, C11, C21, C22.

media-service:
- Resumable multipart upload against MinIO; signed URLs; content-hash dedupe.
- Async workers: ClamAV scan (libclamav or clamd over Unix socket), ffmpeg transcode (HLS for video, opus for audio, webp sizes for images), thumbnails, blurhash.
- E2EE media: server only sees ciphertext; do NOT transcode encrypted blobs; clients pre-process.
- Emits file.uploaded → file.transcoded.

Status (in presence-service):
- Full schema per §B8 (status_posts, status_views, status_reactions, status_archive, status_mutes).
- Personal status E2EE (audience-encrypted, server stores ciphertext).
- Audiences (contacts/except/only), view counts, reactions, view-once, 24h TTL index.

E2EE chat backup (C21):
- Backup blob endpoint: upload + retrieve encrypted blob; server never sees passphrase/key.
- Argon2id parameters documented (memory/time/parallelism).
- Lost passphrase = unrecoverable (explicit warn pattern in API).

View-once (C22):
- single-use key; server enforces one successful fetch then 410 Gone; content-hash refcount delete.

Tests:
- Resumable upload survives 3 simulated network drops.
- AV-infected file rejected end-to-end.
- View-once: 2nd fetch returns 410; cleanup verified.
- E2EE backup round-trip: encrypt → upload → download → decrypt on a different "device" (test instance).

DoD: HLS playlist generated, ClamAV blocks EICAR test file, view-once cleans up, backup never stores plaintext.
```

---

## P5 — Tenancy (orgs/workspaces/teams/channels) + admin

```
Use the `backend-engineer` subagent (primary), with `security-e2ee-engineer` for the tenant guardrails review.

Implement Phase 5 per §B3 + §B7 + §A13 + §G6 (multi-tenant guardrails — this is the cross-cutting hardening landing here).

user-service additions:
- organizations, workspaces, teams, memberships, roles_permissions per §B3.
- Authorize(user, action, resource) API with Valkey cache, invalidated on member.*/role.* events.
- SCIM endpoints (RFC 7644) for provisioning.

Channels:
- Public/private/announcement/broadcast in group-channel-service.
- Server-readable enterprise messages (not E2EE) — explicit feature flag on conversation.

Admin:
- Retention policies, legal hold, audit-log export, DLP keyword policy hooks (event-emitting, not enforcement logic in this phase).
- Audit log: append-only, partitioned by org_id, long retention.

MANDATORY G6 guardrails (this is a hard requirement, not optional):
1. Enable Postgres RLS on every tenant-scoped table; policies use current_setting('app.tenant').
2. The shared repo base class sets the RLS GUC from the AsyncLocalStorage tenant context for every transaction.
3. Tenant context missing → throw (fail-closed). Never default to "all" or "system".
4. Tenant-aware cache wrapper: keys cannot be constructed without a tenant.
5. Tenant-aware OpenSearch query builder: refuses to run without a tenant filter.
6. Every Kafka event for tenant data has tenant_id in the envelope; consumer base class establishes tenant context from event before any access.
7. Authorize-not-just-filter: every single-resource read asserts resource.tenant_id == ctx.tenant_id (defeats IDOR).
8. CI cross-tenant leakage test suite: seed two tenants A and B with overlapping fixtures; iterate every list/search/job/consumer endpoint and assert zero cross-tenant rows in responses.

Tests:
- Every guardrail above has a dedicated test that proves it fails-closed.
- Negative test: a developer "forgets" the WHERE clause — RLS still blocks (verify policy denies).
- Multi-tenant user (member of A and B) switching context: authz cache returns correct role per tenant.

DoD: leakage suite green; intentionally broken endpoint blocked by RLS; SSO login round-trips via Keycloak.
```

---

## P6 — Calls & meetings (signaling + SFU integration)

```
Use the `backend-engineer` subagent and coordinate with `platform-devops-engineer` for LiveKit/coturn deploy.

Implement Phase 6 per §A17 + §B12, flows C8, C9.

call-service:
- calls, call_participants, meetings schemas per §B12.
- WebRTC signaling over WebSocket (room create/join/leave, offer/answer/ICE relay, mute, hand-raise, screenshare).
- LiveKit token issuance (room-scoped, time-bounded JWTs to the SFU).
- Lobby/waiting room (host admit), lock meeting, breakout rooms (sub-rooms + reassign).
- Recording: LiveKit Egress job → MinIO; emits call.recording.ready.
- VoIP push trigger on incoming 1:1 calls (notification-service receives call.started).

Tests:
- 1:1 call set-up: offer/answer/ICE exchanged; LiveKit token valid; both join the room.
- Lobby flow: joiner blocked until host admits.
- Breakout: participant moved to sub-room, returned to main.
- Recording job triggered; stub Egress confirms upload to MinIO.

Platform/infra task (in this phase):
- LiveKit + coturn deployed to network-optimized node pool; UDP host-network; public IPs documented.

DoD: 1:1 video call works in a local cluster between two test clients; recording lands in MinIO; meeting transcript hook fires (Whisper integration happens in P8).
```

---

## P7 — Search + notifications + presence (with G3/G4 hardening)

```
Use the `backend-engineer` and `realtime-engineer` subagents.

Implement Phase 7 per §B13, §B10, §B8, and apply §G3 (realtime hardening) + §G4 (push reliability).

search-service:
- Consumes Kafka (message.*, file.*, user.*, channel.*) → OpenSearch indexes (messages, files, users, channels) with tenant_id + acl/channel_id stamped on every doc.
- Query API with parsed filters (from:/in:/has:/before:); server-side ACL filter injection.
- Personal E2EE explicitly excluded server-side (clients build local index).

notification-service (with G4 hardening):
- Durable outbox table; per-(message,device) idempotency keys; collapse keys per conversation.
- Retry policy with exponential backoff + jitter; DLQ + alert for permanent failures.
- Per-platform routing: APNs / FCM / Web Push (VAPID) / ntfy/WS.
- Push = HINT, not source of truth. Badges/unread computed from server truth via cursor.
- Notification state machine (G4-1): PENDING → SENT → ACKED → DELIVERED | RETRY | FAILED | SUPPRESSED.
- E2EE: no content in push payloads.

presence-service:
- Subscription-scoped fan-out (§A15.2) — only to subscribers:{user}.
- Rich presence resolver (manual/call/idle/calendar priority).
- Aggregation tier for huge fan-in (large announcement channels = pull/long-poll, not push) per §G3-2.

Realtime-gw additions (G3):
- Resume tokens; cheap reattach vs full sync distinction.
- Admission control + token-bucket accept rate + load shedding.
- Jittered exponential backoff guidance documented (client SDK contract).

Tests:
- ACL: tenant A's user can't search tenant B's messages; private channel non-member can't see results.
- Notification idempotency: same (message,device) dispatched twice = one push.
- Push-as-hint: simulate total push outage; client reconnect via cursor recovers full unread state and correct badges.
- Reconnect storm test: 100k synthetic clients reconnect; admission control bounds accept rate; backoff observed.

DoD: G3-1/2/3 + G4-1 test cases green; search respects ACL; no user permanently misses a message under push outage.
```

---

## P8 — AI service + translation (chat auto/manual + real-time call captions)

```
Use the `ai-translation-engineer` subagent.

Implement Phase 8 per §A25 + §A26 + §B20, flows C19 + C20.

ai-service:
- Inference runners (vLLM/Ollama for LLM; local Whisper; NLLB/Marian; Piper TTS; fastText langdetect).
- gRPC + Kafka API: detect_language, translate_text, transcribe_audio_stream, tts_stream, summarize, embed.
- Translation cache: xlate:{sha(text)}:{src}:{tgt} in Valkey + materialized for hot pairs in OpenSearch.
- Privacy fork enforcement (§A26.1, HARD RULE): refuse to process anything tagged as personal-E2EE — these requests must come from on-device. Server-side path only accepts enterprise tenant content with explicit tenant context.

Chat translation:
- Enterprise: on message.sent, detect language; cache-or-translate on first view in a different pref lang.
- chat_translate_pref + user_language tables in Postgres.

Real-time call translation:
- Per-track Whisper streaming (partial + final segments).
- Per-listener NLLB translate; push translated captions via realtime-gw.
- Optional Piper TTS track mixed in by LiveKit Egress for listeners who want voice.

Tests:
- Personal-E2EE-tagged request to ai-service is REJECTED (privacy fork).
- Cache hit on second view (no re-translate).
- Streaming STT produces partial then final captions in a fixture audio.
- Live meeting fixture: 2 listeners with different language prefs each receive captions in their language.

DoD: caption end-to-end latency under target (~2–3s) on the local GPU pool; cache hit-rate metric live; privacy fork rejection has a security test.
```

---

## P9 — Automation, communities, polls, collab artifacts

```
Use the `backend-engineer` subagent.

Implement Phase 9 per §B17, §B16, §A4.7, §B7 (communities), §A4.1 (canvas/clips/lists).

automation-service:
- bots, slash_commands, workflows, webhooks_outbound schemas per §B17.
- Slash command dispatcher → HMAC-signed webhook to bot → response (ephemeral or channel post, or modal open).
- Workflow engine: trigger (message keyword / schedule / form / event) → ordered steps (post / webhook call / branch) → durable queue with retries + DLQ.
- Reminders (/remind) via scheduled jobs.
- App directory CRUD + admin approval gate.

chat-service additions:
- Polls (§B16) — poll + poll_votes; anonymous mode hides voter ids from non-admins; tallies in Valkey.

Communities (§B7) + broadcast lists + announcement channels.

Canvas/clips/lists: minimal data models + APIs only (UI in frontend phase). Canvas content stored as JSON; clips as media references.

Tests:
- Slash command round-trips with HMAC verification.
- Workflow: trigger → 3-step run with one retry on a transient step error; idempotent.
- Poll: anonymous votes don't expose voters; tally consistent under concurrent votes.

DoD: a sample bot responds to /poll and posts results; workflow runs end-to-end with retry; integration test for HMAC tampering rejection.
```

---

## P10 — Scale & harden (cells, multi-region, G-fixes finalized)

```
Use the `platform-devops-engineer` and `backend-engineer` subagents in coordination.

Apply Phase 10 hardening from §F + §G:

Cell architecture (§G3-1):
- Partition accounts by account_id hash into cells; each cell has its own realtime-gw, Valkey, Kafka slice, chat shards.
- Global routing/directory service: account_id → {cell_id, region, conn_locator}; clients connect to their cell's edge.
- Cross-cell delivery worker for cross-cell DMs/channels.

Multi-region:
- Active-active stateless layer; regional realtime-gw + presence.
- Kafka MirrorMaker 2 cross-region for selected topics (E2EE means ciphertext replication is safe).
- Mongo shards per region; Postgres logical replication for directory.
- Tenant data residency: pin a tenant's shard/region.

DR drills:
- Postgres failover (Patroni/CloudNativePG) verified.
- Mongo replica election verified.
- Kafka broker loss verified.
- RPO ≤ 5 min, RTO ≤ 30 min documented and tested.

Final G hardening checkpoints (mark each "tested"):
- G1: E2EE recovery protocols (resend, SKDM-request) + key-transparency log + versioned device list — all live.
- G2: OPRF-PSI contact discovery service replaces hashed-only (separate microservice in user-service or its own).
- G3: cells + resume tokens + admission control + pull-fanout for mega channels — all live.
- G4: outbox + idempotency + DLQ + reconcile — all live and tested under simulated push outage.
- G5: recovery state machine (identity vs history) — tested.
- G6: leakage test suite — green; pool/bridge/silo per tenant configurable.
- G7: registry FULL_TRANSITIVE — enforced; sample expand/contract migration executed in CI.

DoD: chaos test (kill a cell) → users in other cells unaffected; reconnect storm test passes; RPO/RTO drill report attached; G1–G7 status matrix all green.
```

---

# REUSABLE OPERATING PROMPTS

Use these any time during the build — they're short, token-cheap, and tied to the doc.

## OPS-1 — Review my last change

```
Use the `security-e2ee-engineer` subagent.
Review the most recent commit. Check it against §D4 (threat model), §G1 (E2EE), §G6 (tenant isolation), §G7 (schema evolution). 
For each issue: severity (S1/S2/S3), 1-line fix. Reject anything that leaks personal plaintext server-side, keys data on phone number, breaks proto compat, or skips tenant context.
```

## OPS-2 — Fix a failing test (don't relax the test)

```
Test failing: <paste 5–10 lines of failure>.
Fix the implementation, not the test. The test encodes a contract from @docs/VelChat-Architecture.md.
If the test itself is wrong vs. the doc, cite the section that disagrees and propose a doc clarification — do NOT silently weaken the assertion.
```

## OPS-3 — Code audit before phase exit

```
Use the `qa-test-engineer` subagent.
Phase <N> exit audit. Walk the diff since the last phase tag and verify:
1. All Definition-of-Done bullets in the phase prompt are satisfied.
2. Tests cover the §G hardening items relevant to this phase.
3. Tenant context is established on every entry point (HTTP/gRPC/Kafka/job); produce a list of any that aren't and fail-closed them.
4. No secrets in code; no PII in logs (grep for common patterns).
5. Proto changes are FULL_TRANSITIVE; CI compat check passed.
Output: a Markdown table of [check, status, evidence]. Block the phase if any S1/S2 row fails.
```

## OPS-4 — Add a test for a flow

```
Add an integration test (Jest + testcontainers) for flow <Cxx> from @docs/VelChat-Architecture.md.
The test must (a) reproduce the flow's happy path and (b) cover at least 2 §D4 / §G failure modes for that flow.
Place it under the owning service's test/integration/. Use existing fixtures; do not introduce new dependencies.
```

## OPS-5 — Investigate a production-style symptom

```
Symptom: <describe — e.g. "consumer lag rising on message.sent, p99 send latency creeping">.
Use traces + metrics + logs (OTel/Prom/Loki) reasoning only — do not jump to code yet.
Produce: hypothesis tree → 1 most-likely root cause → minimal experiment to confirm → fix plan referencing the relevant §G review item.
```

---

# Order of operations (copy this checklist)

1. **BOOT-0** → repo + CI + dev compose + CLAUDE.md + subagents.
2. **P0** → platform/observability/registry baseline (cross-cutting).
3. **P1** auth → **OPS-3** → tag `phase-1`.
4. **P2** chat+realtime+E2EE → **OPS-3** → tag.
5. **P3** groups+multi-device+epoch → **OPS-3** → tag.
6. **P4** media+status+backup → **OPS-3** → tag.
7. **P5** tenancy+admin (G6 lands here) → **OPS-3** → tag.
8. **P6** calls/meetings → **OPS-3** → tag.
9. **P7** search+notifications+presence (G3+G4 land here) → **OPS-3** → tag.
10. **P8** AI/translation → **OPS-3** → tag.
11. **P9** automation+polls+collab → **OPS-3** → tag.
12. **P10** scale+cells+multi-region+final G matrix → final audit.

Between any two prompts, if Claude Code starts pulling too much context, run `OPS-3` early or open a fresh session — the architecture doc + CLAUDE.md + subagents are persistent, so a fresh session loses nothing.

*End of prompt pack.*
