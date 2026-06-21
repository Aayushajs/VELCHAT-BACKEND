# VelChat — Backend Monorepo

A free, 100% open-source, self-hostable hybrid of **WhatsApp + Microsoft Teams + Slack**.
Production-grade, multi-tenant, real-time, end-to-end encrypted (personal).

> Source of truth: [`docs/VelChat-Architecture.md`](docs/VelChat-Architecture.md) (v2.5). Never contradict it.

## Layout (§D3 — backend only)

> This is the **backend** monorepo. The `clients/` track (web/mobile/desktop/admin) from §D3 lives
> in a separate repo and is intentionally out of scope here.

```
apps/         13 NestJS microservices (api-gateway, realtime-gateway, auth, user, chat,
              group-channel, presence, notification, media, search, call, automation, ai)
libs/         config · shared-utils · shared-types · proto · crypto · event-bus · storage · search
migrations/   @velchat/migrations — SQL migrations + forward-only runner
docker/       compose.yml (local infra) + <service>.Dockerfile per service
deploy/       helm/ · argocd/ · k8s/   (GitOps self-host path; no secrets)
infra/        terraform/ · observability/
postman/      API collection
tools/        scaffold (service generator) · gateway (local dev gateway + start-all)
render.yaml   Render Blueprint (free-tier deploy)
```

## Prerequisites

- Node ≥ 20.11, pnpm ≥ 9 (`corepack enable` or `npm i -g pnpm`)
- Docker + Docker Compose (for local infra)
- `buf` (for proto codegen) — https://buf.build

## Quick start

```bash
pnpm install
pnpm infra:up          # Postgres, Mongo, Valkey, Kafka (KRaft), OpenSearch, MinIO
cp .env.example .env
pnpm build
pnpm test
pnpm dev               # run all services (turbo --parallel)
```

Each service exposes `GET /health`, `GET /ready`, and `GET /metrics` (Prometheus).

## Why Drizzle (not Prisma) for Postgres

1. **SQL-first, no engine/codegen daemon** — schema is plain TypeScript→SQL; migrations are real SQL files, which makes the §G7 expand/contract discipline explicit and reviewable.
2. **Per-transaction RLS GUC is trivial** — `set_config('app.tenant', $1, true)` runs as raw SQL inside the same transaction, exactly what the §G6 tenant guardrail (RLS via `current_setting('app.tenant')`) needs; Prisma's connection-pooled engine makes per-tx GUC awkward and PgBouncer-hostile.
   .

## License

AGPL-3.0-or-later. All dependencies are free/OSS and self-hostable (§D1).
