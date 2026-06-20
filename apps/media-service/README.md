# @velchat/media-service

Resumable uploads (Cloudinary/S3), AV scan, transcode, thumbnails (§B11).

|            |          |
| ---------- | -------- |
| HTTP port  | `3008`   |
| gRPC port  | `50059`  |
| Datastores | postgres |
| Kafka      | both     |

## Endpoints (BOOT-0)

- `GET /health` — liveness
- `GET /ready` — readiness (pings wired datastores)
- `GET /metrics` — Prometheus (RED metrics + default process metrics)

## Run

```bash
cp .env.example .env
pnpm --filter @velchat/media-service build
pnpm --filter @velchat/media-service start
```

Env is validated at boot by `@velchat/config` (zod, fail-closed). See `.env.example`.
