# Backend Onboarding — VelChat

Read this top-to-bottom before your first commit. It covers the repo layout, how to run things
locally, the provider model (how we run at ₹0 and how we scale), the conventions every service
follows, and how a push gets deployed.

> Source of truth for the architecture: [`VelChat-Architecture-v2.md`](../VelChat-Architecture-v2.md)
> (v2.5). Non-negotiable rules: [`../CLAUDE.md`](../CLAUDE.md). Build phases:
> [`../VelChat-ClaudeCode-Prompts.md`](../VelChat-ClaudeCode-Prompts.md).

---

## 1. What this repo is

A NestJS microservices monorepo — a free, open-source, self-hostable hybrid of
**WhatsApp + Teams + Slack**. **13 services** under `apps/`, each its own Nest app, each its own
container/Lambda-equivalent. They share code through small libraries under `libs/`.

```
apps/
├── api-gateway          # edge: aggregation, authn passthrough, rate limit   (HTTP 3000)
├── realtime-gateway     # WebSocket fabric, presence fan-out, reconnect        3001
├── auth-service         # DAPT auth, Reverse-OTP, tokens, device/key dir       3002
├── user-service         # orgs/workspaces/teams, roles, authorize API          3003
├── chat-service         # messages, delivery, receipts, ordering (Mongo)       3004
├── group-channel-service# conversations, channels, communities, epochs         3005
├── presence-service     # presence, last-seen, status/stories                  3006
├── notification-service # outbox, push routing (APNs/FCM/WebPush)              3007
├── media-service        # uploads (Cloudinary/S3), AV scan, transcode          3008
├── search-service       # indexes events → Atlas Search/OpenSearch             3009
├── call-service         # WebRTC signaling, LiveKit tokens, meetings           3010
├── automation-service   # bots, slash commands, workflows, webhooks            3011
└── ai-service           # translation/STT/TTS/summary (privacy fork)           3012

libs/
├── config        # @velchat/config       — zod env schema (fail-closed)
├── common  # @velchat/common  — logger, tracer, tenant-context (ALS), errors,
│                   idempotency, metrics, Nest health/metrics/bootstrap, RLS helpers
├── shared-types  # @velchat/shared-types  — event payloads + generated proto types
├── proto         # @velchat/proto         — .proto contracts (buf workspace)
├── crypto        # @velchat/crypto        — Signal/E2EE opaque boundary (server never decrypts)
├── event-bus     # @velchat/event-bus     — EventBus port + Redis Streams / Kafka adapters
├── storage       # @velchat/storage       — ObjectStorage port + Cloudinary / S3 adapters
└── search        # @velchat/search        — SearchIndex port + Atlas Search / OpenSearch adapters

deploy/   # Helm chart + ArgoCD (self-host / K8s path)
infra/    # Terraform cluster stub + SQL migrations (RLS reference)
docs/     # this folder
render.yaml  # Render Blueprint (free-tier deploy)
```

Every service exposes `GET /health` (liveness), `GET /ready` (readiness), `GET /metrics` (Prometheus).

---

## 2. The provider model (how we stay free, and how we scale)

The app code never talks to a vendor directly — it talks to a **port** (`EventBus`, `ObjectStorage`,
`SearchIndex`) and a `createX(config)` factory picks the adapter from an env var. Flip the selector,
the code is identical:

| Concern | Free-tier (default) | Self-host (scale) | Selector |
|---|---|---|---|
| Relational | **Neon** (Postgres) | Postgres + CloudNativePG | `POSTGRES_URL` |
| Documents | **MongoDB Atlas** | MongoDB self-host | `MONGO_URL` |
| Cache + events | **Upstash** (Redis Streams) | Valkey + Kafka | `EVENT_BUS=redis-streams\|kafka` |
| Search | **Atlas Search** | OpenSearch | `SEARCH_PROVIDER=atlas\|opensearch` |
| Media | **Cloudinary** | MinIO / S3 | `STORAGE_PROVIDER=cloudinary\|s3` |
| Telemetry | **Grafana Cloud** (OTLP) | Tempo/Prometheus/Loki | `OTEL_EXPORTER_OTLP_*` |
| Hosting | **Render** (free) | Kubernetes + ArgoCD | `render.yaml` vs `deploy/` |

Postgres/Mongo/Redis are protocol-compatible, so Neon/Atlas/Upstash need **only a connection string**
— no code change. Kafka↔Redis Streams, S3↔Cloudinary, OpenSearch↔Atlas Search differ, so each lives
behind its adapter in `libs/{event-bus,storage,search}`.

---

## 3. Local setup

```bash
# 1. install (from repo root; corepack provides pnpm)
pnpm install

# 2. start local infra (Postgres, Mongo, Valkey, Kafka, OpenSearch, MinIO) — all free, self-hosted
pnpm infra:up

# 3. configure env
cp .env.example .env            # defaults point at local docker-compose

# 4. build shared packages + services (turbo orders by dependency)
pnpm build

# 5. run a service (or all)
pnpm --filter @velchat/auth-service dev      # one
pnpm dev                                      # all (turbo --parallel)
```

`pnpm test` runs unit tests; `pnpm test:int` runs integration tests against the compose infra.
Env is validated at boot by `@velchat/config` (zod) — a missing/invalid var fails the service fast
with a clear message.

---

## 4. Deploying free (Render + managed free tiers)

1. Create free accounts: **Neon**, **MongoDB Atlas (M0)**, **Upstash**, **Cloudinary**, **Grafana Cloud**.
2. In Render, create a **Blueprint** from `render.yaml`. It defines every service as a Docker web
   service on the free plan and references one env group, `velchat-shared`.
3. Set the secrets in the Render dashboard (they are `sync: false` so they never touch git):
   `POSTGRES_URL`, `MONGO_URL`, `VALKEY_URL`, `CLOUDINARY_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `OTEL_EXPORTER_OTLP_HEADERS`.
4. Render injects `PORT`; `@velchat/config` maps it to `HTTP_PORT` automatically.

> Free-tier reality: Render free services sleep when idle and you can't run all 13 at once. Start
> with the MVP set (api-gateway, auth, user, chat, realtime, presence, notification) and enable the
> rest as you grow. To self-host at scale instead, use `deploy/` (Helm + ArgoCD) and flip the
> selectors to `kafka` / `opensearch` / `s3`.

---

## 5. Conventions (match what you see — code must compose with the shared libs)

- **One service owns its store** (§A10). No cross-service DB access — call gRPC or project an event.
- **Tenant isolation is fail-closed** (§G6): every request/event/job establishes tenant context
  (`runWithTenant`); the data layer throws if it's missing — never defaults to "all". Postgres RLS
  (`set_config('app.tenant', …)` via `PostgresClient.withTenantTransaction`) is the last backstop.
- **E2EE boundary is sacred** (§B6): personal content is opaque ciphertext server-side. Never add a
  path that reads personal plaintext. `@velchat/crypto` throws if you try.
- **Every state change emits an event** with the standard envelope (§G7): `event_id` (idempotency),
  `tenant_id` (isolation), `schema_version` (FULL_TRANSITIVE evolution). Consumers dedupe by `event_id`.
- **No secrets in code/logs.** Read from env via `@velchat/config`. Logs are structured (pino) and
  redact PII / message content.
- **TypeScript strict**: no `any`, no `@ts-ignore`. Cursor pagination only. IDs are UUIDv7/ULID.
- **Conventional Commits**: `feat(chat): …`, `fix(auth): …`. Scope = service or package.

---

## 6. Pre-push checklist

1. `pnpm build` — green.
2. `pnpm test` — green.
3. `pnpm lint && pnpm typecheck` — green (the pre-commit hook runs lint + format:check).
4. If you changed a `.proto`, regenerate (`pnpm proto:gen`) and keep it FULL_TRANSITIVE.
5. New env var? Add it to `@velchat/config` (zod) **and** `.env.example`.
6. Commit message follows Conventional Commits. Don't `git add -A` — add files explicitly.

If something here is wrong or stale, fix the doc in the same PR as the change that contradicted it.
