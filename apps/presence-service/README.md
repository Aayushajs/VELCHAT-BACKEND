# @velchat/presence-service

Presence, last-seen, rich status, status/stories (§B8).

|            |         |
| ---------- | ------- |
| HTTP port  | `3006`  |
| gRPC port  | `50057` |
| Datastores | valkey  |
| Kafka      | both    |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/presence-service build
pnpm --filter @velchat/presence-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
