# @velchat/realtime-gateway

WebSocket fabric — connection registry, fan-out, reconnect/sync-cursor (§B9).

|            |          |
| ---------- | -------- |
| HTTP port  | `3001`   |
| gRPC port  | `50052`  |
| Datastores | valkey   |
| Kafka      | consumer |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/realtime-gateway build
pnpm --filter @velchat/realtime-gateway start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
