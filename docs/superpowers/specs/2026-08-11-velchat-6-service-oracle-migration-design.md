# VelChat — 13 → 6 Service Consolidation + Oracle Always Free Migration

**Status:** design, awaiting approval
**Date:** 2026-08-11
**Scope:** backend (`D:\Velchat`) runtime topology + deployment; mobile (`D:\Velchat-frontend`) contract preserved
**Supersedes:** nothing. Amends §A8 / §A10 / §A21 of `docs/VelChat-Architecture.md` (divergences listed in §9).

---

## 1. Current Architecture Audit

### 1.1 What is actually built

13 NestJS services, **~20,000 LOC** of `apps/**/src`. Size is wildly uneven — the split does not
track the work:

| Service | src files | LOC | Infra clients constructed |
|---|---:|---:|---|
| auth-service | 26 | 3,058 | Postgres, Valkey, bus |
| automation-service | 31 | 3,139 | Postgres, Valkey, bus |
| chat-service | 35 | 2,409 | Mongo, Valkey, bus |
| user-service | 26 | 1,769 | Postgres |
| notification-service | 19 | 1,494 | Postgres, Valkey, bus |
| realtime-gateway | 22 | 1,378 | Valkey, bus |
| media-service | 14 | 1,294 | Postgres, Storage, bus |
| group-channel-service | 11 | 1,269 | Postgres, bus |
| call-service | 18 | 1,170 | Postgres, bus |
| presence-service | 17 | 1,145 | Postgres, Valkey, bus |
| ai-service | 22 | 1,023 | Postgres, bus |
| search-service | 8 | 645 | SearchIndex, bus |
| api-gateway | 6 | 248 | — (Valkey for rate limit) |

### 1.2 How services actually communicate — **no gRPC exists**

Despite §A9 specifying gRPC over a mesh, the repository contains **zero** service-to-service gRPC.
`grpc` appears only in `telemetry.ts` (OTLP exporter). Actual communication:

1. **Event bus** — Redis Streams (default) or Kafka, selected by `EVENT_BUS`. This is the only
   async path and carries all cross-service state propagation.
2. **HTTP via `api-gateway`** — a pure reverse proxy (`gateway/proxy.ts`). It does **not** verify
   JWTs; it forwards the `Authorization` header and lets downstream guards do it.
3. **One direct HTTP call** — `realtime-gateway/fanout/membership-projection.ts` falls back to
   `group-channel-service` when the Valkey membership set is cold (single-flight, 5s timeout, no retry).

**Consequence for this work:** merging services into one process changes *no* network contract.
The services are already event-coupled and store-partitioned. This is the single biggest reason the
consolidation is low-risk.

### 1.3 Datastore ownership (read from code, not from docs)

| Feature domain | Postgres | Mongo | Valkey | Object storage | Search index |
|---|:-:|:-:|:-:|:-:|:-:|
| auth | ✅ | | ✅ | | |
| user | ✅ | | | | |
| group-channel | ✅ | | | | |
| chat | | ✅ | ✅ | | |
| notification | ✅ | | ✅ | | |
| presence (online/typing/last-seen) | | | ✅ | | |
| **status / stories** | **✅** | | | ✅ (media ref) | |
| media | ✅ | | | ✅ | |
| search | | | | | ✅ |
| call / automation / ai | ✅ | | ✅ (jobs) | | |

Two divergences from the architecture doc, confirmed in code:

- §A8 says group-channel-service is "Postgres + Mongo". It is **Postgres only**.
- §A8 groups status/stories with presence. In code they share a service but **not a datastore** —
  presence is pure Valkey, status is pure Postgres. This drives a topology change (§2).

### 1.4 Event bus load — measured, not estimated

**23 real `bus.subscribe()` call sites across 4 consumer groups:**

| Consumer group | Owning service | Subscriptions |
|---|---|---:|
| `search-indexer` | search-service | 9 |
| `realtime-fanout` | realtime-gateway | 7 |
| `notification` | notification-service | 5 |
| `chat-receipts` | chat-service | 2 |
| | **total** | **23** |

`RedisStreamsEventBus.start()` creates **one dedicated Redis connection per subscription**
(`this.pub.duplicate()` inside the loop) and runs an independent
`XREADGROUP … COUNT 10 BLOCK 5000` loop on each.

**Idle command cost (zero users, zero messages):**

```
1 XREADGROUP timeout per 5s per subscription
  = 17,280 commands/day/subscription
  × 23 subscriptions
  = 397,440 commands/day   ← with NOBODY using the app
```

Upstash's free plan is **500,000 commands/month**. 397,440/day exhausts a month's quota in
**≈ 30 hours**. This is the arithmetic behind the recurring suspension problem, and it is the
reason the data tier cannot be managed-free.

### 1.5 Realtime path (verified end to end)

**Server** (`realtime-gateway/src/fabric/ws-fabric.ts`):
`WebSocketServer` on path `/ws` → `extractToken` (Bearer header *or* `?token=`) → `verify` →
register in Valkey `conn:{userId}` set → per-connection `SendQueue` with ephemeral-drop
backpressure → cross-pod delivery over Valkey pub/sub channel `pod:{podId}` → heartbeat sweep
every 25s (ping + `registry.heartbeat`) → graceful drain emits a `reconnect` frame.

**Client** (`Velchat-frontend/apps/mobile/src/infra/realtime/socket.ts`):
one socket, URL `ws://<host>/ws?token=<access>` (RN cannot set headers reliably), client ping every
25s, dead-link watchdog at 60s, close code `4001` = unauthorized/do-not-retry, `4000` = watchdog.
Reconnect policy lives in `SyncEngine`, with full-jitter exponential backoff
(`syncLogic.backoffMs`, base 1s, cap 30s) and `MAX_SEND_ATTEMPTS = 8`.

**Frame contract (must not break):**

- Server → client: `{ kind, type, data }`. Types: `connected`, `pong`, `sync`, `message`,
  `receipt`, `caption`, `typing.started`, `typing.stopped`, `presence` / `presence.changed`,
  `reconnect`, `skdm`.
- Client → server *durable*: `{ kind:'durable', type, data:{…} }` — `sync`, `delivered`, `read`.
- Client → server *ephemeral*: **flat**, `{ kind:'ephemeral', type, ...fields }` — `ping`, `typing`.
  The server's `onInbound` reads `msg.data` first then falls back to top-level, so both shapes work.

**Catch-up is REST, not WS.** The client's `sync` frame is an echo only
(`case 'sync': break; // cursor echo — the REST afterSeq backfill is the real catch-up`).
Durability rests on `GET /chat/conversations/:id/messages?afterSeq=N`.

**Client reconcile rule** (`syncLogic.reconcileDecision`):

```
hasClientMsgIdRow → 'update'   (our own echo/ack updates the optimistic row)
hasSeqRow         → 'skip'     (already have this (conversation_id, seq))
else              → 'insert'
```

Two consequences that constrain the backend:

1. Gaps in `seq` are **safe** — the client keys on `(conversation_id, seq)` identity, not contiguity.
2. A `seq` **reset** is **catastrophic and silent** — replayed low seq values hit `hasSeqRow → skip`,
   so genuinely new messages are dropped by the client with no error anywhere. See DEF-01.

### 1.6 Send path (`chat.service.ts:28`)

```
validate → findByClientMsgId (dedupe) → seq.next() → Mongo insert
  → (duplicate-key ⇒ return winner) → events.messageSent()  → ACK {messageId, seq, serverTs}
```

Correct in shape: dedupe before write, unique-index backstop, event after durable write, fast ACK.
Defects in §1.8.

### 1.7 Deployment surface as built

- `docker/` — 13 Dockerfiles + `compose.yml` running **postgres 16, mongo 7, valkey 8, kafka 3.8,
  opensearch 2.17, minio**.
- `render.yaml` — 13 free-tier web services against Neon + Atlas + Upstash + Cloudinary.
  Render free web services sleep on idle; 13 of them means 13 cold starts.
- `deploy/helm/velchat-service` — one generic chart + 13 values files (deployment, service, hpa, pdb).
- `deploy/k8s/base` — namespace + default-deny NetworkPolicy only.
- `infra/terraform` — 3 files, skeleton.
- Ports/adapters already in place: `EVENT_BUS` (redis-streams | kafka), `STORAGE_PROVIDER`
  (cloudinary | **s3**), `SEARCH_PROVIDER` (atlas | opensearch).

### 1.8 Defects found (these gate the migration)

Ordered by severity. Every one is in the path the goals name explicitly.

| # | Severity | Defect | Evidence | Impact |
|---|---|---|---|---|
| **DEF-01** | **S1** | `seq` has no durable source | `chat/seq.service.ts:12` — `redis.incr('seq:'+id)`, comment admits "Postgres checkpoint is a P-later task" | Valkey restart/eviction/flush ⇒ seq resets to 1 ⇒ unique index `{conversation_id, seq}` rejects every new message in that conversation; and any that land make the client `skip` them (§1.5). **Silent message loss.** Directly violates the stated requirement. |
| **DEF-02** | **S1** | 11 of 13 services have **no authentication**; 23 controllers carry no guard | Only `auth-service` and `group-channel-service` reference `JwtAuthGuard`. `chat.controller.ts:29` is `send(@Body() body: SendMessageDto)` with `senderId` **from the body** | Any caller can send messages as **any user** into **any conversation**, and read any conversation's history. `user-service/admin.controller.ts` is unguarded. api-gateway does not verify JWTs, so nothing upstream catches it. |
| **DEF-03** | **S1** | Idempotency is marked **before** the handler runs | `redis-streams.bus.ts:142` — `markIfNew(event_id)` then `sub.handler(...)` | Process killed between mark and handle ⇒ the event is recorded processed and is skipped on redelivery. **Event loss on crash.** |
| **DEF-04** | **S1** | No pending-entry recovery (`XAUTOCLAIM`/`XPENDING`) | `redis-streams.bus.ts` has no reclaim loop | Crash after `XREADGROUP` before `XACK` leaves the entry in the PEL forever. Nobody ever processes it. **Permanently stuck events.** |
| **DEF-05** | **S2** | Handler error goes **straight to DLQ**, no retry | `redis-streams.bus.ts:153-160` | One transient Mongo/Valkey blip permanently diverts a `message.sent` fanout to the DLQ. |
| **DEF-06** | **S1** | WS JWT verification **fails open** | `ws-fabric.ts:219-221` — falls back to `jwt.decode` when `jwtPublicKey` is absent | A missing `JWT_PUBLIC_KEY` in production silently accepts **forged, unsigned tokens**. |
| **DEF-07** | **S2** | No membership check on inbound WS frames | `ws-fabric.ts` `delivered` / `read` / `typing` / `skdm` accept any `conversationId` | **Receipt spoofing** (force false blue ticks in a stranger's chat) and **typing spoofing**. Both named as requirements. |
| **DEF-08** | **S2** | 23 Redis connections + 397k idle commands/day | §1.4 | Kills any metered Redis; wastes memory and file descriptors locally. |
| **DEF-09** | **S2** | `deliverFromPod` is O(sockets) per frame | `ws-fabric.ts:187` iterates **all** sockets to match one `userId` | At 10k sockets, 10k iterations per delivered frame. Serious on 2 OCPU. |
| **DEF-10** | **S3** | Heartbeat write amplification | client `ping` → `registry.heartbeat`; server `sweep` → `registry.heartbeat` | 2 `EXPIRE` per 25s per user ≈ 6,912 Valkey writes/day/user for presence alone. |
| **DEF-11** | **S3** | No WS payload cap, no origin check, no inbound frame rate limit | `new WebSocketServer({ server, path:'/ws' })` — `ws` default `maxPayload` is 100 MB | Trivial memory-exhaustion and fanout-amplification DoS. |
| **DEF-12** | **S3** | `seq` burned on a failed insert | `chat.service.ts:38` assigns seq before insert | Produces gaps. Safe for this client (§1.5) but must stay documented, since a future contiguity assumption would break. |

---

## 2. Proposed 6-Service Architecture

### 2.1 The topology

| # | Service | Feature libs | Infra it opens | Scaling axis |
|---|---|---|---|---|
| 1 | `edge-gateway` | gateway | Valkey | HTTP RPS |
| 2 | `identity-service` | auth, user, group-channel | Postgres, Valkey, bus | auth RPS |
| 3 | `messaging-service` | chat, notification, **search** | Mongo, Postgres, Valkey, bus | message write throughput |
| 4 | `realtime-service` | realtime, presence | **Valkey, bus only** | concurrent sockets |
| 5 | `content-service` | media, **status** | Postgres, ObjectStorage, bus | upload bandwidth / transcode CPU |
| 6 | `platform-service` | call, automation, ai | Postgres, Valkey, bus | rooms / jobs |

### 2.2 Two deliberate departures from the brief

The brief proposed `presence → realtime-service` and `search → content-service`. The code says both
are wrong. These are the only two changes.

**(a) `status`/`stories` → `content-service`, not `realtime-service`.**

`status.repository.ts` is `PostgresClient`-backed; `presence` is pure Valkey. Keeping status with
presence forces a **Postgres client into the WebSocket process** for a feature that has nothing to do
with sockets. Worse, it couples deploy cadence: every status change would restart the socket process
and **drop every live WebSocket**. Status is content (image/video/voice + audience + view counts +
TTL) and belongs with media. Its realtime element is a `status.posted` fanout, which
`realtime-service` already handles generically.

Result: `realtime-service` becomes **Valkey-only** — the leanest, least-redeployed process in the
system, which is exactly what a socket tier should be.

**(b) `search` → `messaging-service`, not `content-service`.**

Dropping OpenSearch means the message index becomes a Mongo `$text` index on the
`messages` collection. That collection is owned by `chat`. Putting search in `content-service` would
make `content-service` read another service's collection — a direct violation of §A10.5 ("no service
queries another service's database"). Co-locating search with `chat` in `messaging-service` keeps one
owner per collection and one Mongo client.

This also collapses most of the indexing work: Mongo maintains the `$text` index on write, so the
9-subscription `search-indexer` group shrinks to the non-message documents only (users, channels,
files). Message indexing cost goes to **zero**.

E2EE stays intact: the `$text` index is built on a `search_text` field that
`chat.service.ts` already populates **only** when `serverReadable` is true
(`!!input.tenantId && !input.encrypted`). Personal ciphertext is never indexed.

### 2.3 A–F verification of every group

| Group | A. Same scaling axis? | B. Shared store/tx boundary? | C. Failure isolation | D. 2-OCPU profile | E. Process/conn saving | F. Splittable later |
|---|---|---|---|---|---|---|
| **edge-gateway** | yes, RPS | none (stateless) | proxy death = total outage, unchanged from today | ~110 MB, IO-bound | is the single place for rate limit + payload caps | trivially |
| **identity-service** | yes, all request/response Postgres | yes, all Postgres | auth is already a hard dependency of everything — no new blast radius | light | **big win**: `authorize` + membership become in-process calls instead of HTTP | 3 clean libs |
| **messaging-service** | yes — `notification` and `search` consume the same `message.sent` volume `chat` produces | Mongo owner; `notification` prefs in Postgres | ⚠️ push egress (FCM/APNs/SMTP) shares the process with the message hot path → **mitigation required**: bounded push concurrency (4), hard 5s timeout, dedicated consumer group, never on the request path | fine; push is IO-bound | one Mongo client instead of two; `message.sent` consumed in the process that holds the receipts connection | 3 clean libs |
| **realtime-service** | yes, both connection-count driven | yes, both Valkey-only after moving status out | most latency-critical, now with the fewest deploy triggers | leanest process; ~10 KB/socket | 4 Valkey connections instead of 8+ | 2 clean libs |
| **content-service** | yes, upload/transcode/index bursts | Postgres meta + Object Storage blobs | ⚠️ ffmpeg is CPU-heavy → **mitigation required**: transcode concurrency 1 + cgroup `cpus: 0.5` so it cannot starve the socket process | isolated by cgroup | transcode CPU quarantined away from both hot paths | 2 clean libs |
| **platform-service** | mixed axes, but all near-idle in MVP | all Postgres | ⚠️ server-side AI inference would starve job workers → acceptable because personal translation is on-device (§A26.1) and server-side AI is enterprise-only, out of MVP. **Documented split trigger:** extract `ai` first if server-side inference gets real load | idle in MVP | 3 processes → 1 | 3 clean libs |

Every group passes. Two required mitigations (`messaging` push bulkhead, `content` transcode cgroup)
and one documented split trigger (`ai`) are carried into §6 as work items.

### 2.4 Package layout

```
libs/
  infra-context/          NEW — createInfraContext(config, logger, { need: [...] })
  feature-contracts/      NEW — cross-feature ports (interfaces only, no impl)
  feature-auth/  feature-user/  feature-group-channel/
  feature-chat/  feature-notification/  feature-search/
  feature-realtime/  feature-presence/
  feature-media/  feature-status/
  feature-call/  feature-automation/  feature-ai/
  cache common config crypto database event-bus mail proto push search shared-types storage   (unchanged)

apps/
  edge-gateway/  identity-service/  messaging-service/
  realtime-service/  content-service/  platform-service/
```

Composition root, in full:

```ts
// apps/identity-service/src/app.module.ts
const infra = await createInfraContext(config, logger, {
  need: ['postgres', 'valkey', 'eventBus'],      // Mongo is never opened here
});
imports: [
  AuthFeature.forRoot(infra),
  UserFeature.forRoot(infra),
  GroupChannelFeature.forRoot(infra),
]
```

`createInfraContext` is **need-declared**: a process opens exactly the clients it lists and nothing
else. This is what turns "13 services × ~3 clients" into the measured budget in §5.

### 2.5 Boundary enforcement

```js
// eslint.config.mjs — applies to libs/feature-*/** only
'no-restricted-imports': ['error', { patterns: [{
  group: ['@velchat/feature-*'],
  message: 'Feature libs must not import each other. Use the event bus, or a port from ' +
           '@velchat/feature-contracts wired by the composition root.',
}]}]
```

`apps/**` is exempt — wiring is the composition root's job. Without this rule the boundaries rot in
weeks and §2.6 stops working.

The one real cross-feature dependency today, `MembershipProjection`'s HTTP fallback to
group-channel, becomes a `feature-contracts` port:

```ts
// libs/feature-contracts/src/membership.port.ts
export interface MembershipResolver {
  members(conversationId: string): Promise<string[]>;
  isMember(conversationId: string, userId: string): Promise<boolean>;   // NEW — fixes DEF-07
}
```

`realtime-service` gets the HTTP implementation (pointed at `identity-service`, single-flight
preserved). If realtime and identity are ever merged, the composition root swaps in an in-process
implementation and no feature lib changes. `isMember` is the hook that closes receipt/typing spoofing.

### 2.6 The 6 ⇄ 13 switch

`routes.ts` regexes stay **byte-identical** — the public API does not move. Only resolution changes:

```ts
// apps/edge-gateway/src/gateway/topology.ts
const GROUP_OF = {
  AUTH:'IDENTITY', USER:'IDENTITY', GROUP_CHANNEL:'IDENTITY',
  CHAT:'MESSAGING', NOTIFICATION:'MESSAGING', SEARCH:'MESSAGING',
  PRESENCE:'REALTIME',
  MEDIA:'CONTENT', STATUS:'CONTENT',
  CALL:'PLATFORM', AUTOMATION:'PLATFORM', AI:'PLATFORM',
} as const;
// SPLIT_PROFILE=axis6  → resolve UPSTREAM_IDENTITY
// SPLIT_PROFILE=full13 → resolve UPSTREAM_AUTH   (today's behaviour, kept for rollback)
```

`full13` is not decoration — it is the §6 rollback path.

---

## 3. Alternatives Considered

| Option | Processes | RAM | Verdict |
|---|---:|---:|---|
| **Keep 13** | 13 | ~2.3 GB apps | Rejected. ~20k LOC does not need 13 processes; 13 × cold start on Render is the current pain; 39 infra clients; auth must be wired in 13 places. |
| **Domain 6 + Caddy-only edge** (drop the Node gateway) | 6 | −110 MB | Rejected. Distributed Valkey rate limiting, per-user quotas and payload caps need app logic; Caddy needs plugin builds for JWT/rate-limit, adding deployment fragility for ~110 MB. |
| **Lean 3** (core / realtime / workers) | 3 | ~0.6 GB | Rejected as the deploy target, but its `SPLIT_PROFILE` mechanism is adopted. Blast radius too wide: one bad content deploy would drop every socket. |
| **Axis 6 as briefed** (presence+status in realtime, search in content) | 6 | same | Rejected on evidence — forces Postgres into the socket process and makes `content-service` read `chat`'s Mongo collection, violating §A10.5. See §2.2. |
| **Axis 6, amended (chosen)** | 6 | ~0.9 GB | Selected. Every group passes A–F; realtime is Valkey-only; one owner per collection. |
| **Postgres-only** (drop Mongo) | 6 | −900 MB | Rejected for now. Real RAM saving, but requires rewriting `@velchat/database`'s Mongo repositories plus a live data migration — unjustified risk while 12 GB is available. Recorded as a future lever if RAM becomes binding. |

---

## 4. Oracle Always Free Fit

Every resource is checked against Always Free, **not** the $300 trial. The trial is used for nothing
in this design.

| Resource | Need | Always Free? | Notes |
|---|---|---|---|
| Compute | 1 × `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, ARM64 | ✅ | Reduced from 4 OCPU / 24 GB on **2026-06-15**. This is the whole tenancy allowance. |
| Boot volume | 50 GB | ✅ | Counts against the 200 GB block total. |
| Block volume | 150 GB | ✅ | 200 GB total, five backups. |
| Public IP | 1 reserved IPv4 | ✅ | Attached to the instance. |
| Egress | 10 TB/month | ✅ | Far above need. |
| Object storage | 20 GB | ✅ | **Binding constraint.** Allocation in §5. |
| Load balancer | not used | (1 NLB is free) | Caddy on the VM terminates TLS. Skipping the NLB removes a moving part. |
| Autonomous DB | not used | (2 are free) | Oracle DB ≠ Postgres; incompatible with the code. |
| Postgres / Mongo / Valkey | containers on the VM | ✅ (compute) | No managed dependency ⇒ no external quota ⇒ no suspension. |
| TLS certs | Let's Encrypt via Caddy | ✅ | Free, auto-renew. |

Nothing in the design depends on a non-Always-Free resource. **VelChat keeps running unchanged after
the $300 credits expire**, because the credits are never used.

### 4.1 Two Oracle risks that change the design

**ORA-01 — Idle reclamation (S1).** Oracle deems a compute instance idle when **95th-percentile CPU
is under 20% across a 7-day window**, and Always Free idle instances may be reclaimed. An idle chat
backend sits far below that. This would reproduce, on Oracle, the exact suspension problem we are
leaving Render to escape.

p95 ≥ 20% requires CPU above 20% for **more than 5% of the week ≈ 8.4 hours**. That is met with
*genuinely useful* scheduled work rather than a busy-loop — a `maintenance` container running roughly
90 minutes a day:

```
02:00  pg_dump + mongodump + gzip -9        → Object Storage    (~25 min, CPU-bound on gzip)
02:30  Postgres VACUUM ANALYZE + reindex                        (~10 min)
02:45  Mongo compact + $text index validate                     (~10 min)
03:00  restore-drill: restore last night's dump into a temp DB
       and assert row counts                                    (~20 min)
03:30  k6 smoke test against localhost (login → send → receive) (~10 min)
04:00  image prune, log rotate, integration suite               (~15 min)
```

Every line is work worth doing. Keeping the instance alive is a by-product, not the purpose.

The alternative mitigation — upgrading to Pay-As-You-Go while staying inside Always Free limits —
exempts the instance from idle reclamation and improves A1 capacity priority, at ₹0 as long as usage
stays within the free allowances. It requires a card and therefore an OCI **budget alert at $1** plus
hard service limits. Offered as an explicit choice (see ORA-01 in §7) — not assumed by this design.

**ORA-02 — A1 "Out of host capacity" (S1).** A1 capacity is heavily constrained in most regions;
provisioning frequently fails outright. This is a *deployment blocker*, not a performance issue.
Mitigations, in order: (1) an OCI-CLI launch-retry script (`oci compute instance launch` in a
backoff loop — this is the standard workaround and usually succeeds within hours); (2) try every
availability domain in the region; (3) PAYG upgrade for capacity priority; (4) as a stopgap only, the
2 × AMD `E2.1.Micro` Always Free instances — 1/8 OCPU and 1 GB RAM each, enough for Caddy plus a
watchdog but **not** for this stack.

### 4.2 Region: Mumbai vs Hyderabad

Both `ap-mumbai-1` and `ap-hyderabad-1` are single-AD India regions, so neither gets the
multi-AD capacity advantage. The decision matters because **Always Free compute can only be created
in the tenancy's home region, and the home region is fixed at signup.**

- **Mumbai** — India's primary peering hub; best average RTT for India-wide users; also the most
  contested for A1 capacity.
- **Hyderabad** — newer, less contested, so typically easier A1 provisioning; adds roughly 10–20 ms
  for north and west India users.

**Recommendation: Mumbai.** Capacity is a *temporary* obstacle with a known workaround (retry
script, PAYG priority), whereas the latency penalty and the home-region choice are effectively
**permanent**. Trading a permanent cost for a temporary one is the wrong trade. Choose Hyderabad only
if a Mumbai retry script fails to obtain A1 within about 72 hours.

I could not find hard published A1-availability data per India region; the Mumbai-is-more-contested
point is inference from its size and general community reports, so treat it as a judgement call
rather than a measured fact.

### 4.3 What gets deleted from the current compose

| Component | RAM reclaimed | Replaced by |
|---|---:|---|
| OpenSearch 2.17 | ~2,500 MB | Mongo `$text` index (`mongo-text` adapter) |
| Kafka 3.8 | ~1,200 MB | Redis Streams on local Valkey (already the default) |
| MinIO | ~200 MB | Oracle Object Storage via the **existing** `s3` adapter |
| | **~3.9 GB** | |

---

## 5. Resource Budget

Measured baselines for Nest + ioredis + pg + mongodb on ARM64, with explicit caps.

### 5.1 Memory — 12 GB budget

| Container | Steady | Peak | Cap applied |
|---|---:|---:|---|
| caddy | 30 MB | 60 MB | — |
| edge-gateway | 110 MB | 180 MB | `--max-old-space-size=192` |
| identity-service | 150 MB | 260 MB | `=288` |
| messaging-service | 180 MB | 320 MB | `=384` |
| realtime-service | 140 MB + 10 KB/socket | 240 MB @ 5k sockets | `=384` |
| content-service | 150 MB | 480 MB (ffmpeg) | `=256` + ffmpeg `cpus:0.5` |
| platform-service | 140 MB | 240 MB | `=256` |
| postgres:16 | 400 MB | 600 MB | `shared_buffers=256MB`, `max_connections=60` |
| mongo:7 | 900 MB | 1,100 MB | **`--wiredTigerCacheSizeGB=0.5`** — critical: the default is ~50% of (RAM − 1 GB) ≈ **5.5 GB** on this box |
| valkey:8 | 300 MB | 340 MB | `maxmemory 256mb`, **`maxmemory-policy noeviction`** (see DEF-01) |
| maintenance (cron) | 20 MB | 700 MB (gzip/restore) | scheduled 02:00–04:00 only |
| **Total** | **≈ 2.5 GB** | **≈ 4.5 GB** | **7.5 GB headroom** |

Two caps are load-bearing. Without `wiredTigerCacheSizeGB` Mongo alone would claim ~5.5 GB. Without
`noeviction` Valkey may evict a `seq:*` key and trigger DEF-01.

### 5.2 CPU — 2 OCPU (≈2 vCPU ARM)

| Container | Reservation | Limit | Rationale |
|---|---|---|---|
| realtime-service | 0.4 | 1.0 | highest-priority latency path |
| messaging-service | 0.3 | 1.0 | send hot path |
| postgres / mongo / valkey | 0.15 each | 0.8 each | |
| identity / edge / platform | 0.1 each | 0.5 each | |
| content-service | 0.1 | **0.5** | hard cap so ffmpeg cannot starve sockets |
| maintenance | 0 | 1.5 | night window only |

Limits intentionally oversubscribe; reservations are what guarantee the hot paths under contention.

### 5.3 Connections

| Store | Today | After | Detail |
|---|---:|---:|---|
| Postgres | ~5 services × pool 10 = **50** | **15** | identity 6, messaging 3, content 3, platform 2, maintenance 1 |
| Mongo | 2 services × pool 10 = **20** | **10** | messaging only |
| Valkey | 23 readers + ~13 = **36** | **14** | edge 1; identity 2; messaging 4 (pub + 3 group readers); realtime 4 (pub, registry, pod-sub, 1 group reader); content 2; platform 1 |
| **Redis stream readers** | **23** | **4** | one multiplexed `XREADGROUP` per consumer group — `search-indexer`, `notification`, `chat-receipts` land in `messaging-service`, `realtime-fanout` in `realtime-service` (§6, DEF-08) |
| **Total pooled connections** | **~106** | **~39** | |

### 5.4 Event bus commands after the fix

```
before : 23 subs × 17,280/day = 397,440 cmd/day idle
after  : 4 groups, BLOCK 0 (local Valkey)
         ≈ 0 idle commands; ~6 commands per event delivered
```

Multiplexing works because `XREADGROUP GROUP g c STREAMS s1 s2 s3 > > >` reads many streams in one
call when the group name is shared — which it is, per consumer group. `BLOCK 0` is safe on local
Valkey (no proxy idle-timeout); `EVENT_BUS_BLOCK_MS` keeps 30000 available for proxied endpoints.

### 5.5 Disk — 200 GB total

| Use | Size |
|---|---:|
| Boot volume (OS, Docker, images) | 50 GB |
| Postgres data + WAL | 20 GB |
| Mongo data (messages) | 90 GB |
| Valkey AOF | 2 GB |
| Backup staging | 20 GB |
| Logs + slack | 18 GB |

### 5.6 Object storage — 20 GB (binding)

| Bucket | Allocation |
|---|---:|
| `velchat-media` | 12 GB |
| `velchat-backups` (7 daily + 3 monthly, gzipped) | 6 GB |
| slack | 2 GB |

**Trigger at 16 GB used:** either move media to the block volume behind a `local` storage adapter
(≈90 GB available) or move backups off-site. Alerted by the maintenance job.

### 5.7 Processes and network

6 Node processes + Caddy + 3 stores + 1 cron = **11 containers**, down from 13 apps + 6 infra = 19.
Egress is dominated by media download; against a 12 GB media ceiling, the 10 TB/month allowance is
not a constraint.

---

## 6. Migration Plan

Seven phases. Old and new runtimes coexist until Phase 7; `SPLIT_PROFILE=full13` is the rollback at
every step.

### Phase 0 — Fix the S1 defects (before any restructuring)

Deliberately first: these are bugs in today's code, and fixing them under the current topology means
each fix is verified in isolation rather than tangled with the move.

| Work | Defect | Approach |
|---|---|---|
| Durable `seq` | DEF-01 | Lua fast path: `EXISTS` → `INCR`, else return `-1`; on `-1` read `MAX(seq)` from Mongo, `SET key <max> NX`, `INCR`. `SET NX` makes concurrent seeding safe (loser's `SET` no-ops, its `INCR` still yields a higher value). Unique-index duplicate-key → reseed and retry once. Valkey gains `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`. |
| Global auth | DEF-02 | Register `JwtAuthGuard` as a **global** guard in every composition root, with the existing `@Public()` decorator as the only opt-out. Replace body-supplied identity with `@CurrentUser('accountId')` in all 23 controllers. Add `isMember` checks to send/history/receipts. Fail-closed: no `JWT_PUBLIC_KEY` ⇒ refuse to boot. |
| Bus correctness | DEF-03, 04, 05 | Mark idempotency **after** successful handling. Add an `XAUTOCLAIM` reclaim loop (min-idle 60s). Retry a failed handler 3× with jittered backoff before the DLQ. |
| WS hardening | DEF-06, 07, 11 | Remove the `jwt.decode` fallback (verify or reject). `isMember` gate on `delivered`/`read`/`typing`/`skdm`. `maxPayload: 64 KB`, origin allowlist, per-connection inbound token bucket. |
| Bus efficiency | DEF-08 | Multiplex subscriptions per `groupId` into one `XREADGROUP`; `EVENT_BUS_BLOCK_MS` default 0. |
| Fanout indexing | DEF-09, 10 | Index sockets `userId → Set<connId>`. Single heartbeat path (drop the duplicate `registry.heartbeat` in `sweep`). |

**Exit:** every test in §8.1–8.4 green on the 13-service topology. Rollback: plain git revert, no
data or topology change.

### Phase 1 — Extract feature libs (no behaviour change)

`git mv` each `apps/<svc>/src/<domain>` → `libs/feature-<domain>`, add `package.json` +
`tsconfig.json` per lib, fix import paths, add the eslint boundary rule. The 13 apps keep running,
now importing their own feature libs.

**Exit:** `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green; all 13 services still boot
and pass integration tests. Rollback: revert (mechanical, no runtime change).

### Phase 2 — `infra-context` + `feature-contracts`

Add `createInfraContext` with need-declaration. Convert each `AppModule.forRoot` to take the shared
context instead of constructing its own clients. Add `MembershipResolver` and its HTTP implementation.

**Exit:** 13 services boot on the shared context; connection counts drop measurably; §8 green.

### Phase 3 — 6 composition roots (both topologies live)

Add the 6 new apps. **Do not delete the 13.** Add `SPLIT_PROFILE` to `edge-gateway`. Six new
Dockerfiles.

**Exit:** the same integration suite passes against `SPLIT_PROFILE=axis6` and `full13`. A contract
test asserts that the two profiles expose an identical route set.

### Phase 4 — Contract + integration verification

Run §8 in full against `axis6` locally with the real compose stack. Add the `mongo-text` search
adapter and verify search parity. Add the compose↔helm env-parity test.

**Exit:** every §8 case green on `axis6`; frontend runs against it unmodified.

### Phase 5 — Oracle deployment

Provision A1 (retry script), attach block volume, install Docker + Compose, `compose.oracle.yml`
(6 apps + 3 stores + Caddy + maintenance), Caddy TLS with `/ws` routed straight to
`realtime-service`, seed secrets, restore a dump, run the restore drill, wire the maintenance
schedule and the OCI budget alert.

**Exit:** reproducible from a blank tenancy by following `deploy/ORACLE.md`; restore drill passes;
CPU p95 confirmed above 20%.

### Phase 6 — Canary

Point a staging hostname at Oracle. Run the real mobile app against it: send/receive, offline
catch-up, reconnect, multi-device, receipts. Keep Render on `full13` as the live fallback. Watch 48h.

**Exit:** no S1/S2 regressions over 48 hours; latency at or better than Render.

### Phase 7 — Cut over and clean up

Move DNS. After 7 more days clean, delete the 13 old `apps/`, their Dockerfiles, and their
`render.yaml` entries. Keep `SPLIT_PROFILE=full13` support and the Helm charts (now 6 values files).

**Rollback path at every phase**

| Phase | Rollback |
|---|---|
| 0–2 | `git revert`; no topology or data change |
| 3–4 | `SPLIT_PROFILE=full13`; new apps simply unused |
| 5 | Render stays live; Oracle is additive |
| 6 | DNS stays on Render |
| 7 | DNS back to Render (within the 7-day window); after cleanup, revert the deletion commit |

---

## 7. Risk Register

| ID | Risk | Sev | Likelihood | Mitigation | Residual |
|---|---|---|---|---|---|
| ORA-01 | Idle reclamation, p95 CPU < 20% / 7 days | S1 | High if unmitigated | Useful ~90 min/day maintenance workload (§4.1); CPU p95 alert at 25%; optional PAYG exemption | Low |
| ORA-02 | A1 out of host capacity | S1 | High | Launch-retry script; all ADs; PAYG priority; Hyderabad fallback after 72h | Medium — schedule risk only, not a design flaw |
| ORA-03 | 20 GB object storage ceiling | S2 | Medium at scale | Alert at 16 GB; documented switch to block-volume media | Low |
| ORA-04 | Single VM = SPOF | S2 | Certain by design | Nightly dump + boot-volume snapshot; weekly restore drill; `deploy/ORACLE.md` rebuild is ~30 min | Accepted: RTO ~30 min, RPO ~24 h. Worse than §D2's 5 min / 30 min — **an explicit free-tier trade-off** |
| ORA-05 | Free-tier terms change again (they did on 2026-06-15) | S2 | Medium | Everything is a portable container + env contract; §4 re-check quarterly | Low |
| DAT-01 | Valkey loss resets `seq` ⇒ silent client-side message drop | **S1** | High today | DEF-01 fix: durable seed + `noeviction` + AOF + duplicate-key retry | Low |
| DAT-02 | Event marked processed then lost on crash | S1 | Medium | DEF-03 fix: mark after handling | Low |
| DAT-03 | Events stuck in the PEL forever | S1 | Medium | DEF-04 fix: `XAUTOCLAIM` reclaim loop | Low |
| SEC-01 | Unauthenticated write/read across all services | **S1** | **Exploitable now** | DEF-02 fix: global guard + `@Public()` + `@CurrentUser` + `isMember` | Low |
| SEC-02 | WS auth fails open without `JWT_PUBLIC_KEY` | S1 | Medium | DEF-06 fix: verify or reject; refuse to boot without the key | Low |
| SEC-03 | Receipt / typing spoofing | S2 | Exploitable now | DEF-07 fix: `isMember` gate | Low |
| SEC-04 | SSRF via the membership HTTP fallback | S2 | Low | URL from env only, never from a request; allowlist host; 5s timeout, no redirects | Low |
| PERF-01 | ffmpeg starves the socket process on 2 OCPU | S2 | High without a cap | `cpus: 0.5` + transcode concurrency 1 + separate container | Low |
| PERF-02 | Push egress blocks the message hot path | S2 | Medium | Bounded concurrency 4, 5s timeout, consumer group off the request path | Low |
| PERF-03 | `deliverFromPod` O(sockets) per frame | S2 | High at scale | DEF-09 fix: index by `userId` | Low |
| PERF-04 | Reconnect storm after a deploy | S2 | Medium | Existing `reconnect` frame + client full-jitter backoff; staggered container restarts; accept-rate token bucket | Low |
| DEP-01 | Helm charts rot while compose is the live target | S3 | High | CI env-parity test: compose and helm must yield the same env key set | Low |
| DEP-02 | ARM64-only images block an AWS x86 move | S2 | Low | `buildx` multi-arch `linux/amd64,linux/arm64` from Phase 3 | Low |
| FE-01 | A backend change breaks the mobile client | S1 | Low | Frame contract and reconcile rule pinned in §1.5; contract tests; `seq` gaps proven safe; no client change required | Low |

---

## 8. Tests

Commands are exact. Results are recorded after execution — none are claimed in advance.

### 8.1 Baseline (must pass unchanged throughout)

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int          # testcontainers
```

### 8.2 Sequence durability (DEF-01)

```bash
pnpm test:int -- seq.durability
```

| Case | Assertion |
|---|---|
| 100 concurrent sends, one conversation | 100 distinct seq, strictly increasing, no duplicate-key error |
| `FLUSHALL` on Valkey mid-run, then send | next seq > previous max; **no seq reset**; client `reconcileDecision` returns `insert`, never `skip` |
| Valkey container restart | seq continues from the durable max |
| `maxmemory-policy` eviction pressure on `seq:*` | key survives (`noeviction`) |
| Duplicate `clientMsgId` × 50 concurrent | exactly one document; all 50 responses carry the same `messageId` + `seq` |
| Insert failure after seq assignment | gap appears; client still reconciles correctly (documents DEF-12) |

### 8.3 Event bus (DEF-03/04/05/08)

```bash
pnpm test:int -- eventbus.reliability
```

Handler throws → retried 3× → DLQ on the 4th. Process killed between `markIfNew` and handler →
event **is** reprocessed after restart. Entry left in the PEL → reclaimed by `XAUTOCLAIM` within
90s. Duplicate `event_id` → handled once. Redis restart → consumers reconnect, no lost entries.
Measured: idle command count over 60s ≈ 0 with `BLOCK 0`; reader connections == number of groups.

### 8.4 Auth and authorization (DEF-02/06/07)

```bash
pnpm test:int -- security.authz
```

One case per unguarded controller: no token → 401. Valid token, `senderId` in body ≠ JWT subject →
identity comes from the JWT, never the body. Non-member sends to a conversation → 403. Non-member
reads history → 403. Non-member sends `delivered`/`read` over WS → rejected, no receipt stored.
Non-member sends `typing` → not fanned out. WS with no `JWT_PUBLIC_KEY` configured → service refuses
to boot. WS with an unsigned token → close 4001. WS frame > 64 KB → connection closed.

### 8.5 Messaging and receipts

```bash
pnpm test:int -- messaging.e2e
```

1:1 realtime delivery; 100 rapid sends (order by seq preserved); 500-message stress; duplicate send;
out-of-order event arrival; reconnect mid-send; offline catch-up via `afterSeq`.
Receipt monotonicity is asserted explicitly: the sender's state machine may only advance
`sending → sent → delivered → read`; a late `delivered` arriving after `read` must **not** regress
the UI state. Duplicate receipts are idempotent (`$max: { up_to_seq }` already gives this).

### 8.6 WebSocket lifecycle

```bash
pnpm test:int -- ws.lifecycle
```

Connect, disconnect, reconnect with backoff, heartbeat pong, dead-socket watchdog at 60s, network
switch (new socket while the old is half-open), background/foreground, graceful drain emits
`reconnect` then closes, 4001 is not retried.

### 8.7 Infrastructure chaos

```bash
pnpm test:int -- chaos.restart
```

Restart each of Valkey, Mongo, Postgres, and each of the 6 services in turn; assert no message loss
(every message eventually appears via cursor sync) and that a cold membership projection self-heals
through `MembershipResolver` with exactly one HTTP call under 100 concurrent requests
(single-flight).

### 8.8 Multi-device

```bash
pnpm test:int -- multidevice.sync
```

Devices A, B, C on one account: a message sent from A appears on B and C; receipts reconcile; a
device offline during the exchange catches up on reconnect without duplicates.

### 8.9 Load (sized to 2 OCPU)

```bash
k6 run tools/load/ws-connect.js   --vus 2000 --duration 5m
k6 run tools/load/send-message.js --vus 200  --duration 5m
```

Recorded: RSS per container, CPU per container, send p50/p99, socket memory per connection,
Valkey commands per second. Budget: send p99 < 300 ms locally, and p99 < 1 s end-to-end (§D2).

### 8.10 Deployment reproducibility

```bash
docker compose -f docker/compose.oracle.yml config     # validates
docker buildx build --platform linux/amd64,linux/arm64  # multi-arch
pnpm test -- deploy.env-parity                          # compose vs helm env sets match
bash deploy/oracle/restore-drill.sh                     # restore last dump, assert row counts
```

---

## 9. Final Recommendation

**Consolidate to 6, with the two amendments in §2.2.** The evidence supports it:

- ~20k LOC across 13 processes is over-split. There is no gRPC to unwind and no shared-store
  violation to untangle — services are event-coupled and store-partitioned, so merging changes no
  network contract.
- The measured wins are concrete: **~106 → ~39 pooled connections**, **23 → 4 stream readers**,
  **397,440 → ~0 idle bus commands/day**, **~3.9 GB reclaimed** by dropping OpenSearch, Kafka and
  MinIO, and 13 cold starts collapsed to 6 warm processes on a persistent VM.
- Consolidation makes the security fix *structurally* achievable: a global fail-closed guard at 6
  composition roots is auditable in a way that 13 scattered wirings demonstrably was not — 11 of 13
  services never got one.

**Where I disagree with the brief.** Two groupings were wrong, and the code is why:

1. `status`/`stories` is Postgres-backed content, not a realtime signal. Keeping it with presence
   drags Postgres into the WebSocket process and makes every status deploy drop every live socket.
   Moving it to `content-service` leaves `realtime-service` **Valkey-only**.
2. `search`'s index lives on `chat`'s Mongo `messages` collection. Putting search in
   `content-service` would make it read another service's store — a §A10.5 violation. In
   `messaging-service` there is one owner per collection, one Mongo client, and message indexing
   becomes free because Mongo maintains the `$text` index on write.

**What matters more than the refactor.** The audit surfaced **six S1 defects that exist today** and
that no amount of restructuring would fix:

- **SEC-01** — 11 of 13 services accept unauthenticated requests; `chat` takes `senderId` from the
  request body. Anyone can post as anyone into any conversation and read any history. This is live.
- **DAT-01** — `seq` is a bare Valkey `INCR`. One Valkey restart resets it, and because the client
  skips on `(conversation_id, seq)` match, the failure mode is **silent message loss** — no error on
  either side.
- **DAT-02 / DAT-03** — idempotency marked before handling, and no PEL recovery: events are lost on
  crash and stuck forever after a mid-processing kill.
- **SEC-02** — WS auth falls back to `jwt.decode` when `JWT_PUBLIC_KEY` is absent: a missing env var
  turns forged tokens into valid ones.

These contradict the "zero message loss" and "never trust client-provided userId/senderId" goals
directly, so **Phase 0 fixes them first, on the current topology**, before any files move. That
ordering is deliberate: each fix gets verified in isolation instead of being entangled with the
restructure.

**Deployment.** Oracle Always Free fits with 7.5 GB of RAM headroom, and the design uses **none** of
the $300 credits, so nothing changes when they expire. Two Oracle-specific risks are real and are
designed around rather than assumed away: idle reclamation (ORA-01, answered with a genuinely useful
90-min/day maintenance window that keeps p95 CPU above 20%) and A1 capacity (ORA-02, a schedule risk
with a known retry workaround). Region: **Mumbai**, because the latency and home-region choices are
permanent while capacity scarcity is temporary.

**Accepted trade-off, stated plainly.** A single VM gives RTO ≈ 30 min and RPO ≈ 24 h, against
§D2's targets of 30 min and 5 min. RPO is worse by design — that is the price of ₹0, and the honest
mitigation is the nightly dump plus a *tested* restore drill, not a claim of high availability.
