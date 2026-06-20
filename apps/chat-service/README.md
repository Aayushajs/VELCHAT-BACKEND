# @velchat/chat-service

Messages, delivery, receipts, ordering via per-conversation seq (§B4).

|            |               |
| ---------- | ------------- |
| HTTP port  | `3004`        |
| gRPC port  | `50055`       |
| Datastores | mongo, valkey |
| Kafka      | both          |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/chat-service build
pnpm --filter @velchat/chat-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
