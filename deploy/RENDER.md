# Deploy VelChat to Render (free tier)

The repo ships a **Render Blueprint** (`render.yaml`) that deploys the built core services as Docker
web services. Datastores are **managed free tiers** (Neon / Atlas / Upstash / Cloudinary) — Render
hosts only the stateless services. No paid SaaS, no secrets in git.

> Render free web services **sleep after ~15 min idle** and cold-start on the next request. Fine for
> a demo/MVP; upgrade the plan for always-on.

---

## 1. Create the free managed datastores (once)

| Need            | Provider          | What to copy                           | Env var                |
| --------------- | ----------------- | -------------------------------------- | ---------------------- |
| PostgreSQL      | **Neon**          | connection string (`?sslmode=require`) | `POSTGRES_URL`         |
| MongoDB         | **Atlas** (M0)    | SRV string `mongodb+srv://…`           | `MONGO_URL`            |
| Redis + Streams | **Upstash**       | `rediss://…` URL                       | `VALKEY_URL`           |
| Media           | **Cloudinary**    | `cloudinary://key:secret@cloud`        | `CLOUDINARY_URL`       |
| Traces/metrics  | **Grafana Cloud** | OTLP endpoint + `Authorization` header | `OTEL_EXPORTER_OTLP_*` |

Atlas/Neon/Upstash: allow access from anywhere (`0.0.0.0/0`) so Render can reach them.

## 2. Deploy the Blueprint

1. Push this repo to GitHub (already done: `Aayushajs/VELCHAT-BACKEND`).
2. Render dashboard → **New → Blueprint** → connect the repo → it reads `render.yaml`.
3. Render lists the 7 core services. Click **Apply**.
4. First build runs `pnpm install && pnpm -r build` per service (a few minutes each).

## 3. Set the secrets (once, shared by all services)

Dashboard → **Env Groups → `velchat-shared`** → fill the `sync:false` keys from step 1
(`POSTGRES_URL`, `MONGO_URL`, `VALKEY_URL`, `CLOUDINARY_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`). All services read from this group — set them in one place.

## 4. Run the database migrations (once)

From your machine, pointed at the Neon URL:

```bash
POSTGRES_URL="postgres://…sslmode=require" pnpm db:migrate
```

This applies `migrations/src/sql/*` (auth, RLS reference, conversations, device-list/key-transparency).

## 5. Verify

Each service is reachable at its own URL:

```
https://velchat-auth-service.onrender.com/health     → {"status":"ok"}
https://velchat-auth-service.onrender.com/docs        → Swagger UI
https://velchat-chat-service.onrender.com/docs
https://velchat-group-channel-service.onrender.com/docs
```

> The unified `:8080` gateway is a **local-dev** convenience (`pnpm start:all`). In production the
> edge is Envoy/Kong in Kubernetes (see `deploy/helm`, architecture §A12); on Render each service has
> its own URL. A frontend points at the per-service URLs (or an upgraded api-gateway proxy).

## Notes

- **Port:** services listen on the port Render injects — config maps `PORT → HTTP_PORT`, no change needed.
- **Enabling more services:** uncomment the trailing block in `render.yaml` (Dockerfiles already exist).
- **Build cost:** each image builds the whole monorepo; expect multi-minute first builds on free tier.
- **Kubernetes path:** for a real cluster use `deploy/helm` + `deploy/argocd` (GitOps), not Render.
