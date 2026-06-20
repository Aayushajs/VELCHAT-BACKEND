# @velchat/automation-service

Bots, slash commands, workflows, outbound webhooks (§B17).

|            |          |
| ---------- | -------- |
| HTTP port  | `3011`   |
| gRPC port  | `50062`  |
| Datastores | postgres |
| Kafka      | both     |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/automation-service build
pnpm --filter @velchat/automation-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
