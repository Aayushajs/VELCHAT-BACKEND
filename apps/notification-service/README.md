# @velchat/notification-service

Durable outbox, push routing (APNs/FCM/WebPush), idempotent dispatch (§B10).

|            |          |
| ---------- | -------- |
| HTTP port  | `3007`   |
| gRPC port  | `50058`  |
| Datastores | postgres |
| Kafka      | consumer |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/notification-service build
pnpm --filter @velchat/notification-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
