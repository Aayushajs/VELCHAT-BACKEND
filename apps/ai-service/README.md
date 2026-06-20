# @velchat/ai-service

Translation/STT/TTS/summary; enterprise-only server path (privacy fork §A26.1).

|            |         |
| ---------- | ------- |
| HTTP port  | `3012`  |
| gRPC port  | `50063` |
| Datastores | valkey  |
| Kafka      | both    |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/ai-service build
pnpm --filter @velchat/ai-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
