# @velchat/group-channel-service

Conversations, members, channels, communities, device-list epochs (§B7).

|            |          |
| ---------- | -------- |
| HTTP port  | `3005`   |
| gRPC port  | `50056`  |
| Datastores | postgres |
| Kafka      | both     |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/group-channel-service build
pnpm --filter @velchat/group-channel-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
