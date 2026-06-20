# @velchat/api-gateway

Edge API gateway — request aggregation, authn passthrough, rate limiting (§A12).

|            |          |
| ---------- | -------- |
| HTTP port  | `3000`   |
| gRPC port  | `50051`  |
| Datastores | —        |
| Kafka      | producer |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/api-gateway build
pnpm --filter @velchat/api-gateway start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
