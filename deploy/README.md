# Deploying VelChat

One codebase, four targets, one environment contract. Pick a target and follow its README.

| Target           | Free compute                                  | For how long              | Profile                            | Runbook                         |
| ---------------- | --------------------------------------------- | ------------------------- | ---------------------------------- | ------------------------------- |
| **Oracle Cloud** | A1 ARM, 2 OCPU / **12 GB**                    | **forever** (Always Free) | `axis6` + local data tier          | [`oracle/`](./oracle/README.md) |
| **AWS**          | `t4g.small`, 2 vCPU / 2 GB                    | until **31 Dec 2026**     | `axis6` + external data tier       | [`aws/`](./aws/README.md)       |
| **Azure**        | `B1S`, 1 vCPU / 1 GB (+ $100 Students credit) | **12 months**             | **`mono`** — 1 GB fits one process | [`azure/`](./azure/README.md)   |
| **Render**       | free web services (sleep when idle)           | ongoing                   | `axis6` + managed free tiers       | [`render/`](./render/README.md) |

**Start with Oracle.** It is the only target whose compute is free indefinitely, and it has 6× the
RAM of AWS free and 12× of Azure free. A reasonable product setup is Oracle for production and
Azure for Students for staging/CI — two clouds, both ₹0, identical images.

Free-tier numbers are verified and sourced in [`PORTABILITY.md`](./PORTABILITY.md), which also
covers what changes per cloud and what scaling looks like afterwards.

## Layout

```
deploy/
  README.md            this file — pick a target
  PORTABILITY.md       verified free-tier matrix, the portability contract, scaling path
  shared/
    Caddyfile          ONE edge config for every target; upstreams come from env
  oracle/              compose.yml · .env.example · README.md · scripts/{launch-retry,backup,restore}.sh
  aws/                 compose.yml · .env.example · README.md
  azure/               compose.yml · .env.example · README.md
  render/              README.md   (the blueprint itself is /render.yaml — Render requires it at the repo root)
  helm/                velchat-service chart + 6 values files, for EKS / AKS / OKE
  k8s/base/            namespace + default-deny NetworkPolicy
  argocd/              GitOps app-of-apps
```

Two deliberate choices in that layout:

- **One Caddyfile, not four.** The upstreams are environment variables, so the same file serves the
  six-service topology and `mono`. An edge config that drifts per cloud is where TLS and routing
  bugs hide.
- **One env contract, per-target templates.** Each `.env.example` is the same variable set with
  target-appropriate values, so diffing two targets shows only what genuinely differs.

## What every target needs

```bash
# RS256 keypair. REQUIRED: each service verifies tokens itself and refuses to boot without the
# public half. Unset also means auth mints an ephemeral key per restart, logging everyone out.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.key
openssl rsa -in jwt.key -pubout -out jwt.pub
```

`JWT_PRIVATE_PEM` is a secret and only identity-service needs it. `JWT_PUBLIC_PEM` is public and
**every** service needs it. `AUTH_DEV_INSECURE=true` exists for local development only and is
refused in production.

## Local development

```bash
pnpm db:up                 # Postgres + Mongo + Valkey via docker/compose.yml
pnpm start:all             # all six services + a dev gateway on http://localhost:8080
pnpm dev:messaging         # or one service at a time
```
