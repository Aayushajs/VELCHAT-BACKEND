# @velchat/user-service

Orgs/workspaces/teams, memberships, roles, authorize API (§B3).

|            |                  |
| ---------- | ---------------- |
| HTTP port  | `3003`           |
| gRPC port  | `50054`          |
| Datastores | postgres, valkey |
| Kafka      | both             |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/user-service build
pnpm --filter @velchat/user-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
