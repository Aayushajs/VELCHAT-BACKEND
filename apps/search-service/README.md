# @velchat/search-service

Indexes events to Atlas Search/OpenSearch with tenant + ACL stamping (§B13).

|            |          |
| ---------- | -------- |
| HTTP port  | `3009`   |
| gRPC port  | `50060`  |
| Datastores | —        |
| Kafka      | consumer |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/search-service build
pnpm --filter @velchat/search-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
