# VelChat — Feature Flag & Remote Configuration Platform

> **Status:** Design (document-before-implement gate). **Datastore:** MongoDB only. **Host:** a new
> `feature-flags` module inside **platform-service**. **Backward-compatible:** additive only — no
> existing API, event, schema, socket, or test changes.

This document is the analysis + plan + ADR the implementation must follow. It reuses the existing
VelChat infrastructure (auth, tenant context, Valkey cache, event bus, realtime fan-out, audit,
logging, DTO/response/error conventions, the durable interval-worker) — **no parallel abstractions**.

---

## 1. Repository & architecture analysis (what we integrate into)

| Concern | Existing mechanism (reused as-is) |
|--------|-----------------------------------|
| Service shape | `XModule.forRoot(deps): DynamicModule` wired in `app.module.ts`; `bootstrapService()` adds tenant interceptor, response envelope, error filter, CORS, Swagger, graceful drain |
| HTTP responses | `ResponseInterceptor` → `{ success, statusCode, message, data }`; errors → `AllExceptionsFilter` mapping the `AppError` hierarchy (`ValidationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `GoneError`, …) |
| Validation | `class-validator` DTO classes + global `ValidationPipe` (whitelist + transform) |
| AuthN | `Authorization: Bearer <JWT>` verified at the edge-gateway; `account_id`/`tenant_id`/`role` in claims |
| Tenancy / AuthZ | `TenantInterceptor` + `requireTenant()` / `currentTenantId()` (ALS, fail-closed §G6); RBAC via role claim |
| MongoDB | `MongoClient` (`@velchat/database`) — `mongo.db.collection('…')` accessor; app-generated string ids |
| Cache | `ValkeyClient` (`@velchat/cache`) — `redis` handle, TTL, bounded connect |
| Events | `buildEnvelope({ eventType, key, producer, tenantId, payload })` + `EventBus.publish/subscribe` (Kafka or Redis-Streams); `EventPayloads` map in `@velchat/shared-types` |
| Realtime push | services emit an event → **realtime-service `fanout-consumer`** subscribes → `event-router` fans to clients over WS |
| Scheduling / background | platform-service **durable interval-worker** (`automation/job.worker.ts`) — same pattern reused for schedule + cleanup |
| Audit | append-only records (auth `auth_audit`, admin audit); flags keep their own Mongo `flag_audit` + emit `featureflag.changed` |
| Config | `zod` env schema in `@velchat/config` (`MONGO_URL`, `VALKEY_URL` already present) |
| Observability | OTel traces + Prometheus RED via `ObservabilityModule`; structured logs (no PII) |

**Integration deltas (all additive):**
1. New module `apps/platform-service/src/feature-flags/**` (Mongo-only).
2. platform-service `app.module.ts`: add a `MongoClient` + `ValkeyClient` (only when `MONGO_URL`/`VALKEY_URL` set) and wire the module + its schedule/cleanup worker into the existing `managed` lifecycle.
3. `@velchat/shared-types`: add `FeatureFlagChangedPayload` + register `featureflag.changed` (additive, FULL_TRANSITIVE-safe).
4. realtime-service `fanout-consumer`: subscribe `featureflag.changed` → broadcast a small "flags changed" frame to connected clients (they refetch). New `broadcast` path on the fabric — additive.
5. edge-gateway routing table: route `/feature-flags` → platform-service (one ordered rule).

No existing collection, table, event, endpoint, socket message, or test is modified.

---

## 2. ADR — key decisions

**ADR-1 — Host in platform-service (not a new service, not identity-service).**
Feature management is config + automation. platform-service already owns workflows, reminders, and a **durable interval-worker** — exactly what scheduled enable/disable, auto-rollback, and cleanup need. A new service adds ops (deploy, mesh, dashboards) for no benefit; identity-service is identity/tenancy and would blur its bounded context. *Trade-off:* platform-service gains a Mongo + Valkey dependency (both already used elsewhere, so no new tech). Reversible: the module is self-contained and could be lifted into a `config-service` later without API changes.

**ADR-2 — MongoDB only (per requirement).** Flags are schema-flexible (rollout rules, variants, config payloads, version snapshots) and read-hot. Mongo fits document evaluation + versioned snapshots; no relational joins are needed. PostgreSQL is deliberately untouched.

**ADR-3 — Evaluate in-process against a cached definition set (not per-eval DB/queries).** The definition set for a tenant is cached in Valkey (`ff:flags:{tenant}`); evaluation is a **pure function** over that set + request context. This gives O(1) cache read + CPU-only evaluation → millions of low-latency evals, no N+1, no collection scans on the hot path. Cache is invalidated event-driven on every mutation.

**ADR-4 — Deterministic bucketing.** `bucket = fnv1a(userId + ':' + flagKey) % 10000` → stable per-user assignment across evaluations and pods (no sticky storage needed). Percentage rollout compares `bucket < percentage*100`; variants use weighted ranges over the same bucket.

**ADR-5 — Config versioning + rollback via immutable snapshots.** Every mutation writes a `flag_config_versions` snapshot and bumps `version`. Rollback = copy a prior snapshot forward as a new version (never rewrites history) → clean audit + instant emergency rollback.

**ADR-6 — Real-time via the existing event → fan-out path.** Mutations emit `featureflag.changed`; realtime-service broadcasts a lightweight "refetch" signal. Clients pull the new evaluated set (cheap, cached). No flag *values* travel over the socket → no new leak surface and no per-client fan-out cost.

---

## 3. MongoDB collection design

All ids are app-generated `uuidv7()` strings (matching the codebase). Every tenant-scoped doc carries
`tenant_id` (`null` = global/platform scope). Global flags apply to all tenants; a tenant-scoped flag
with the same `key` overrides the global one for that tenant.

### 3.1 `feature_flags`
```jsonc
{
  "_id": "uuidv7",
  "key": "new-chat-ui",              // stable identifier used by clients
  "tenant_id": "org-123 | null",     // null = global platform flag
  "type": "boolean | config | experiment",
  "description": "…",
  "tags": ["ui", "chat"],
  "enabled": true,                   // MASTER kill switch (false ⇒ always off/default)
  "value": { "...": "..." },         // remote-config payload (type=config)
  "defaultValue": false,             // returned when off / not targeted
  "variants": [                      // type=experiment / multivariate
    { "key": "control", "value": false, "weight": 50 },
    { "key": "treatment", "value": true, "weight": 50 }
  ],
  "rollout": {
    "percentage": 25,                // 0..100
    "segmentIds": ["seg-…"],         // any-match
    "rules": [                       // ALL-match (AND); each rule is attribute op values
      { "attribute": "country",    "op": "in",        "values": ["IN","US"] },
      { "attribute": "platform",   "op": "in",        "values": ["ios","android"] },
      { "attribute": "appVersion", "op": "semverGte",  "values": ["2.4.0"] },
      { "attribute": "role",       "op": "in",        "values": ["admin"] }
    ],
    "userOverrides": { "acc-1": true, "acc-2": "treatment" }  // highest priority
  },
  "dependencies": ["parent-flag-key"],  // ON only if all dependencies evaluate ON
  "state": "active | archived",
  "version": 7,
  "created_at": "iso", "updated_at": "iso", "updated_by": "acc-…"
}
```
**Indexes:** unique `{ key: 1, tenant_id: 1 }` · `{ tenant_id: 1, state: 1 }` · `{ tags: 1 }`.

### 3.2 `flag_segments` — reusable targeting groups
```jsonc
{ "_id":"seg-…", "tenant_id":"…|null", "key":"beta-testers", "name":"…",
  "rules":[ { "attribute":"role","op":"in","values":["beta"] } ], "created_at":"iso" }
```
Index: unique `{ key: 1, tenant_id: 1 }`.

### 3.3 `flag_config_versions` — immutable history + rollback source
```jsonc
{ "_id":"ver-…","flag_id":"…","key":"…","tenant_id":"…|null","version":6,
  "snapshot":{ /* full feature_flags doc at v6 */ },
  "changed_by":"acc-…","reason":"rollout 25%→50%","created_at":"iso" }
```
Index: `{ flag_id: 1, version: -1 }`.

### 3.4 `flag_audit` — who / what / when (append-only)
```jsonc
{ "_id":"aud-…","tenant_id":"…|null","flag_id":"…|null","actor_id":"acc-…",
  "action":"create|update|enable|disable|rollout|schedule|rollback|kill|archive|maintenance|announcement",
  "before":{…}|null,"after":{…}|null,"at":"iso" }
```
Indexes: `{ tenant_id: 1, at: -1 }` · `{ flag_id: 1, at: -1 }`.

### 3.5 `flag_schedules` — scheduled enable/disable (worker-driven)
```jsonc
{ "_id":"sch-…","flag_id":"…","tenant_id":"…|null","action":"enable|disable",
  "run_at":"iso","status":"pending|done|cancelled","created_by":"acc-…","created_at":"iso" }
```
Index: `{ status: 1, run_at: 1 }` (worker query: due + pending). TTL index on `created_at` (e.g. 90d) prunes finished rows.

### 3.6 `platform_config` — global maintenance mode + announcement/banner (singleton per scope)
```jsonc
{ "_id":"global | <tenant_id>",
  "maintenance": { "enabled":false,"message":"…","allowlistFlagKeys":["…"],"allowRoles":["admin"] },
  "announcement": { "enabled":true,"level":"info|warn|critical","text":"…","startsAt":"iso","endsAt":"iso" },
  "updated_by":"acc-…","updated_at":"iso" }
```

---

## 4. Evaluation engine (pure, unit-tested)

`evaluate(flag, ctx, { segmentMatches, depsOn }) → { key, on, value, variant?, reason }`

Order (first decisive rule wins):
1. **Kill switch** — `flag.enabled === false` → `{ on:false, value:defaultValue, reason:'killed' }`.
2. **Dependencies** — any dependency not ON → `off, reason:'dependency'`.
3. **User override** — `rollout.userOverrides[ctx.userId]` present → that value, `reason:'override'`.
4. **Rules (AND)** — every `rollout.rules` entry must match `ctx` (ops: `in`, `eq`, `neq`, `gte`, `lte`, `semverGte`, `semverLt`). Fail → `off, reason:'rule'`.
5. **Segments (OR)** — if `segmentIds` non-empty and none match → `off, reason:'segment'`.
6. **Percentage / variants** — `bucket = fnv1a(userId+':'+key) % 10000`; if `bucket >= percentage*100` → `off, reason:'percentage'`; else pick the weighted variant (or `on=true`) → `reason:'rollout'`.

Maintenance mode is evaluated once per request from `platform_config`: when `maintenance.enabled` and the caller's role ∉ `allowRoles`, only flags in `allowlistFlagKeys` evaluate normally; the rest return their `defaultValue` with `reason:'maintenance'`. Pure + deterministic → fully unit-testable; no I/O inside.

---

## 5. Caching & invalidation (Valkey, reused)

- `ff:flags:{tenant}` → JSON array of active flag docs for the tenant (global + tenant-scoped), TTL ~300s.
- `ff:segments:{tenant}` → segments; `ff:platform:{tenant|global}` → platform config.
- **Read path:** evaluation loads the set from cache (miss → Mongo → backfill), then evaluates in-process. No per-flag DB hit on the hot path.
- **Invalidation:** every mutation deletes the affected `ff:*` keys **and** emits `featureflag.changed`. Other pods drop their local copy lazily on next read (cache is the source, Mongo the truth).

---

## 6. Real-time propagation

New event (additive):
```ts
// @velchat/shared-types
export interface FeatureFlagChangedPayload {
  tenant_id: TenantId | null;   // null = global → affects all tenants
  flag_key: string;
  action: 'update' | 'enable' | 'disable' | 'rollout' | 'rollback' | 'schedule' | 'kill'
        | 'archive' | 'maintenance' | 'announcement';
  version: number;
}
// EventPayloads: 'featureflag.changed': FeatureFlagChangedPayload
```
- platform-service emits it after each committed mutation / worker action.
- realtime-service `fanout-consumer` subscribes and broadcasts a compact `{ type:'featureflag.changed', tenant_id, flag_key }` frame to connected clients (per-pod broadcast). Clients re-call `/feature-flags/evaluate`. **No flag values on the wire.**

---

## 7. API (admin RBAC + evaluation) — existing style, envelope + DTOs

Routed via the gateway: `/feature-flags`. Admin routes require tenant context + an admin role (reuse the existing role guard); evaluation routes require a valid JWT only.

**Admin — flags**
- `POST /feature-flags` · `GET /feature-flags` (filter/tag/cursor) · `GET /feature-flags/:key` · `PATCH /feature-flags/:key`
- `POST /feature-flags/:key/enable` · `/disable` (kill switch)
- `POST /feature-flags/:key/rollout` (percentage / segments / rules / overrides)
- `POST /feature-flags/:key/schedule` (`{ action, runAt }`) · `DELETE /feature-flags/:key/schedule/:id`
- `POST /feature-flags/:key/rollback` (`{ toVersion }`) — emergency rollback
- `GET /feature-flags/:key/versions` · `GET /feature-flags/:key/audit`
- `DELETE /feature-flags/:key` (archive — soft)

**Admin — segments & platform**
- `POST/GET/PATCH/DELETE /feature-flags/segments`
- `GET /feature-flags/platform` · `PUT /feature-flags/platform/maintenance` · `PUT /feature-flags/platform/announcement`

**Evaluation (client, cached, low-latency)**
- `POST /feature-flags/evaluate` `{ context:{ userId?, country?, platform?, appVersion?, role?, attrs? } }` → `{ flags: { [key]: { on, value, variant?, reason } }, announcement?, maintenance? }`
- `GET /feature-flags/evaluate/:key?...context` → single flag result

---

## 8. Automation (reuses the durable interval-worker)

A `FlagScheduleWorker` (same shape as `automation/job.worker.ts`) runs on an interval:
1. **Scheduled enable/disable** — find `flag_schedules` where `status:'pending'` and `run_at <= now`; apply the action (bump version, snapshot, audit, invalidate cache, emit event), mark `done`.
2. **Auto-rollback hook** — a flag may carry `guard:{ rollbackToVersion }`; a documented interface + `POST …/rollback` cover manual + hook-driven rollback. Health-metric-triggered rollback is a documented extension point (subscribe to `moderation.flagged`/RED alerts → call rollback).
3. **Cleanup** — archive past-due one-off schedules; prune `flag_config_versions` beyond the retained N (e.g. keep last 50); TTL handles `flag_schedules`/`flag_audit` retention.

Every automated action goes through the same audit + cache-invalidation + event path as a manual one.

---

## 9. Security

- Admin endpoints: tenant context required (fail-closed) + admin role check; evaluation endpoints: authenticated JWT.
- **Every** mutating action writes a `flag_audit` record (actor, before/after) — non-negotiable.
- Input validated by DTOs; no magic strings (enums for `op`/`action`/`type`).
- Rate limiting is inherited from the edge-gateway; the evaluation endpoint is cache-served.
- No internal config is exposed on evaluation responses (only `{on,value,variant,reason}` per flag).

---

## 10. Performance

- Hot path = one Valkey read + pure-CPU evaluation → no N+1, no collection scans, no per-eval writes.
- Indexes cover every admin query (`{key,tenant_id}`, `{tenant_id,state}`, `{flag_id,version}`, `{status,run_at}`).
- Deterministic bucketing needs no sticky storage. Cache TTL + event invalidation keeps reads fresh without polling.
- Evaluation response is itself cacheable per `(tenant, contextHash)` for a short TTL if needed (extension).

---

## 11. Risk analysis & mitigations

| Risk | Mitigation |
|------|-----------|
| Flags service down → clients can't evaluate | Clients cache last-known flags locally + fall back to `defaultValue`; evaluation is best-effort, never blocks the app |
| Stale cache after change | Event-driven invalidation + short TTL; worst case = one TTL window |
| Bad rollout locks users out | Kill switch (`/disable`) + emergency `/rollback` (instant, versioned); global maintenance allowlist |
| Adding Mongo/Valkey to platform-service | Both already used elsewhere; wired only when the URL is set; boot stays non-fatal (§infra-lifecycle) |
| Broadcast storm on mass change | Broadcast carries only a "refetch" signal (no values); clients debounce refetch |
| Multi-tenant leakage | Tenant scoping on every collection + query; global vs tenant precedence explicit; admin routes tenant-guarded |

---

## 12. Migration / rollout plan

Additive only — no data migration. Sequence:
1. Land `@velchat/shared-types` event (additive) → build.
2. Land the `feature-flags` module + worker in platform-service (guarded by `MONGO_URL`/`VALKEY_URL`; absent ⇒ module simply not wired, service unaffected).
3. Add the realtime-service `featureflag.changed` broadcast.
4. Add the edge-gateway route rule.
5. Indexes are created idempotently on module boot (`createIndex`), no separate migration.

Rollback: remove the module wiring — nothing else references it; no schema/contract is broken.

---

## 13. Operational guide

- **Create + roll out:** `POST /feature-flags` → `POST /:key/rollout {percentage:10}` → widen → `enable`.
- **Emergency off:** `POST /:key/disable` (kill switch, instant).
- **Emergency rollback:** `POST /:key/rollback {toVersion}` (restores a prior snapshot as a new version).
- **Maintenance mode:** `PUT /feature-flags/platform/maintenance {enabled:true, allowRoles:['admin']}`.
- **Announcement/banner:** `PUT /feature-flags/platform/announcement {enabled, level, text, startsAt, endsAt}`.
- **Audit:** `GET /feature-flags/:key/audit`. **History/versions:** `GET /:key/versions`.
- **Health:** module contributes to `/ready` via its Mongo/Valkey pings; worker logs each fired schedule.

---

## 14. Future extension points

Experiments → metrics sink for A/B analysis; health-triggered auto-rollback (subscribe RED/alerts);
per-`(tenant,contextHash)` evaluation cache; SDK/client libraries; approval workflow before rollout
(reuse automation workflows); import/export of flag sets; OpenFeature-compatible provider adapter.
