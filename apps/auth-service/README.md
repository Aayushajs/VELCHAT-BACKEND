# @velchat/auth-service

DAPT auth, Reverse-OTP, tokens, device/key directory (§B2).

|            |                  |
| ---------- | ---------------- |
| HTTP port  | `3002`           |
| gRPC port  | `50053`          |
| Datastores | postgres, valkey |
| Kafka      | producer         |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/auth-service build
pnpm --filter @velchat/auth-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
