# @velchat/call-service

WebRTC signaling, LiveKit tokens, meetings, recording (§B12).

|            |          |
| ---------- | -------- |
| HTTP port  | `3010`   |
| gRPC port  | `50061`  |
| Datastores | postgres |
| Kafka      | both     |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/call-service build
pnpm --filter @velchat/call-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
