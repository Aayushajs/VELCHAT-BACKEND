# CI/CD

Two workflows. `ci.yml` guards every pull request; `release.yml` turns a merge to `main` into a
version, seven signed container images, a GitHub Release, and a running deployment.

---

## Environments

| | development | production |
| --- | --- | --- |
| Branch | `dev` | `main` |
| Host | Render (free web services) | Azure VM `B2as_v2`, Central India |
| Topology | `axis6` — six services | `mono` — one process |
| Deployed by | Render, building from source | `release.yml`, pulling signed images from GHCR |
| Base URL | `https://velchat-edge-gateway-2aje.onrender.com` | `https://velchat.duckdns.org` |
| TLS | yes, Render terminates it | yes — Let's Encrypt via Caddy |
| Data tier | Neon · Atlas · **Upstash** · Cloudinary | Neon · Atlas · **local Valkey** · Cloudinary |
| Always on | sleeps after ~15 min idle | only while the VM is running |

Both branches run the full `ci.yml` on push, because both deploy from a push and neither should
deploy something unverified.

Clients talk only to the **edge gateway** — one base URL per environment, not one per service.
Render's individual service URLs, the WebSocket endpoints, and the commands for verifying either
environment end to end (including an authenticated `wss://` session) are in
[RUNBOOK.md](RUNBOOK.md) section 0b.

Two differences are deliberate rather than incidental:

- **Redis.** Render has no local container, so it uses Upstash. The Azure box runs Valkey locally
  because `EVENT_BUS=redis-streams` means consumers read continuously, and Upstash's free 500k
  commands/month is exhausted by that alone in about a day. If the dev event bus goes quiet, that
  is the first thing to check.
- **Topology.** Render runs six services, Azure runs one. Same code through the same assembler —
  only `SPLIT_PROFILE` differs — so dev stays a fair test of production behaviour, but Render gives
  each service its own hostname and the gateway routes between them via `fromService`.

Render appends a random suffix when a service name is taken, which is why the URLs carry `-2aje`.
The blueprint resolves upstreams with `fromService` rather than hardcoding them, so the suffix does
not matter.

## The pipeline

```text
                              ┌─────────────────────────┐
                              │      pull request       │
                              └────────────┬────────────┘
                                           │
   ┌───────────────────────────────────────┴───────────────────────────────────────┐
   │ verify        lint · typecheck · test · build          (whole monorepo)        │
   │ proto-compat  buf breaking-change check vs main         (§G7 FULL_TRANSITIVE)  │
   │ security      Trivy fs scan · CycloneDX SBOM            (CRITICAL = block)     │
   │ images        hadolint ×7 · build velchat-mono          (no push)              │
   └───────────────────────────────────────┬───────────────────────────────────────┘
                                           │  all green
        ┌──────────────────────────────────┴──────────────────────────────────┐
        │                                                                     │
   push to dev                                                          merge to main
        │                                                                     │
        ▼                                                                     ▼
┌────────────────────┐                        ┌───────────────────────────────────────────┐
│ RENDER builds from │                        │ version   read commits since the last v*  │
│ source, 6 services │                        │           tag → next semver               │
│ SPLIT_PROFILE=     │                        │              │                            │
│    axis6           │                        │              ├── bump=none ──► stop here   │
└─────────┬──────────┘                        │              ▼                            │
          │                                   │ images ×7  build → push GHCR              │
          │ CI polls /health                  │            cosign sign (digest)           │
          ▼                                   │            SBOM + provenance attached     │
   environment:                               │            Trivy scan (CRITICAL = stop)   │
   development                                │              ▼                            │
   (dev only)                                 │ publish    git tag + GitHub Release       │
                                              │              ▼                            │
                                              │ deploy     ┌─ VM deallocated? ─┐          │
                                              │            │  yes → start it   │          │
                                              │            └─────────┬─────────┘          │
                                              │              scp compose + Caddyfile      │
                                              │              docker compose pull / up -d  │
                                              │              smoke-check /health          │
                                              │            ┌─ did WE start it? ─┐         │
                                              │            │  yes → deallocate  │always() │
                                              │            └────────────────────┘         │
                                              └───────────────────┬───────────────────────┘
                                                                  ▼
                                                          environment:
                                                          production
                                                          (main only)
```

Three properties are worth stating explicitly, because they are what make the pipeline safe rather
than merely automated:

1. **Images are pushed before the tag exists.** A failed build therefore leaves no tag and no
   release, so a tag in this repository always denotes something that actually built.
2. **A `docs:`/`chore:`-only merge stops after `version`.** No release, no deploy, no noise.
3. **The deploy leaves the VM as it found it** — see below.

### What the deploy does to the VM

| VM before | After | Why |
| --- | --- | --- |
| deallocated | started → deployed → **deallocated again** | The box is off most of the day to conserve credit; a deploy should not silently turn it into a running bill. |
| already running | deployed → **left running** | Someone is working on it. A deploy is not a reason to pull the box out from under them. |

The shutdown runs under `always()`. The failure to design against is not "stop failed" but "stop
was skipped because something else broke" — a failed deploy is exactly when a box gets forgotten.
The started-by-CI flag is written *before* `az vm start`, so even a failure during startup still
triggers the shutdown. It retries three times, then reads the power state back and fails loudly if
the VM is still running rather than reporting success over a ticking meter.

A `B2as_v2` left on unnoticed costs roughly **$1.20/day** out of a fixed credit.

> **Consequence worth understanding:** with auto-stop on, production is only reachable while the VM
> is running. Between deploys the site is down. That is correct for a demo box and wrong for one
> serving real clients — if you need it always-on, remove the deallocate step and accept ~$36/month.

### Branch policies

`production` accepts deployments only from `main`, `development` only from `dev`. Set as GitHub
environment branch policies, so a workflow cannot deploy the wrong branch to the wrong place even
if its `if:` condition is edited incorrectly.

> GitHub's repo-home Deployments panel is **not** branch-filtered — it lists every environment
> regardless of the branch being viewed, and there is no setting to change that. Use the
> Deployments page's left sidebar to view one environment at a time. Render additionally creates
> its own `dev - velchat-<service>` environment per service, which is Render's naming, not ours.

## Versioning

The version comes from the commit messages, so a merge produces a release without a second PR to
approve.

| Commit | Bump | Example |
| --- | --- | --- |
| `fix:` · `perf:` · `revert:` | patch | `8.0.0 → 8.0.1` |
| `feat:` | minor | `8.0.0 → 8.1.0` |
| `feat!:` or a `BREAKING CHANGE:` body | major | `8.0.0 → 9.0.0` |
| `docs:` · `chore:` · `test:` · `refactor:` · `style:` | none | no release |

**Pre-1.0 guard.** While the major is `0` the API is not declared stable, so a breaking change
bumps the *minor* (`0.4.1 → 0.5.0`) instead of declaring `1.0.0`. Whether a project is 1.0 is a
decision a human makes, not something a commit message should be able to trigger by accident. Tag
`v1.0.0` by hand when you mean it, and normal major bumps take over from there.

The last `v*` tag is the base. The repository already carried tags up to `v7.0.0` from earlier
merges, so the first automated release landed on **`v8.0.0`** — not on `0.2.0`, which is what the
then-stale `package.json` version would have suggested. `package.json` has been brought in line
with the tag lineage. The `package.json` seed only applies when no `v*` tag exists at all.

This replaced a Changesets flow. Changesets is the right tool for publishing many independently
versioned npm packages; this repo publishes **container images from one repo-wide version**, and
its "Version Packages" PR meant a release needed two merges instead of one.

---

## Images

Published to GHCR, which namespaces by repository **owner**:

```text
ghcr.io/aayushajs/velchat-velchat-mono         ← the 1 GB / Azure target
ghcr.io/aayushajs/velchat-edge-gateway
ghcr.io/aayushajs/velchat-identity-service
ghcr.io/aayushajs/velchat-messaging-service
ghcr.io/aayushajs/velchat-realtime-service
ghcr.io/aayushajs/velchat-content-service
ghcr.io/aayushajs/velchat-platform-service
```

Each is pushed with three tags — `<version>`, `sha-<commit>`, and `latest` — and carries an SBOM,
build provenance, and a cosign signature. Deploy configs read the namespace from `IMAGE_REPO`, so a
fork only sets that one variable.

**Architecture.** `linux/amd64` only by default, because arm64 has to run under QEMU on GitHub's
runners — roughly triple the build time across seven images, spent on an architecture the current
Azure B1S target does not use. To publish for Oracle A1, AWS Graviton or Azure B2pts, re-run the
workflow from the Actions tab with `platforms=linux/amd64,linux/arm64`.

**Why pull requests build only one image.** The seven Dockerfiles differ only in `WORKDIR`,
`EXPOSE` and `CMD`; the expensive and breakable part — `pnpm install` plus `pnpm -r build` over the
whole monorepo — is identical in each. `velchat-mono` exercises it most completely because it mounts
every feature group. `hadolint` still lints all seven on every PR, so a typo in one of the six is
caught without paying to build it.

### Verifying an image

The signature covers the **digest**, not a tag, so it stays bound to exactly the bytes that were
scanned:

```bash
cosign verify ghcr.io/aayushajs/velchat-velchat-mono:0.2.0 \
  --certificate-identity-regexp "^https://github.com/Aayushajs/VELCHAT-BACKEND/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

## Required GitHub secrets

`GITHUB_TOKEN` is provided automatically and covers pushing to GHCR. Everything below is for the
deploy job only — without them, build and release still work and only `deploy` fails.

| Secret | Required | What it is |
| --- | --- | --- |
| `AZURE_HOST` | yes | Public IP or DNS name of the VM |
| `AZURE_USER` | yes | SSH user (`azureuser` on an Azure Ubuntu image) |
| `AZURE_SSH_KEY` | yes | **Private** key, full PEM including the BEGIN/END lines |
| `AZURE_PUBLIC_URL` | yes | e.g. `https://chat.example.com`, for the post-deploy `/health` check |
| `AZURE_SSH_HOST_KEY` | recommended | Pins the host key. Without it the workflow warns and trusts the host on first sight, which is open to MITM. Get it with `ssh-keyscan -H <host>` |
| `AZURE_SSH_PORT` | no | Defaults to `22` |

The VM's `.env` — database URLs, `INTERNAL_API_SECRET`, storage keys — **stays on the VM** and is
never uploaded by CI. A workflow run therefore never has access to production credentials.

### Approval gate

The `deploy` job runs in the `production` GitHub Environment. It deploys automatically as shipped.
To require a human first: **Settings → Environments → production → Required reviewers**. Every
deploy then waits for approval, with no workflow change.

---

## One-time Azure VM setup

```bash
# B1S (1 vCPU / 1 GB), Ubuntu 22.04
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER" && newgrp docker

# The env file the deploy expects at a fixed path. Fill in the REQUIRED values.
curl -fsSL https://raw.githubusercontent.com/Aayushajs/VELCHAT-BACKEND/main/deploy/azure/.env.example \
  -o ~/velchat.env
nano ~/velchat.env
```

CI copies `compose.yml` and `Caddyfile` into the home directory on each deploy, so nothing else
needs cloning. Point your DNS `A` record at the VM before the first deploy — Caddy needs it to
obtain a Let's Encrypt certificate.

Run the database migrations once against your managed Postgres before the first deploy, and again
after any release that adds one:

```bash
pnpm --filter @velchat/migrations migrate
```

---

## Rollback

Every release is an immutable tag, so rolling back is choosing an older one:

```bash
ssh azureuser@<host>
TAG=0.4.1 docker compose -f ~/velchat-compose.yml --env-file ~/velchat.env up -d
```

Pin `TAG` in `~/velchat.env` if you want the box to stay on that version until you say otherwise —
the next CD run would otherwise move it forward again.

Migrations are expand/contract by policy (§A22), so the previous image keeps working against the
newer schema. That is what makes a rollback safe without a database restore.

---

## Verified end to end

The pipeline has run for real. Merging `dev` into `main` produced **`v8.0.0`**: seven images built
and pushed to GHCR, signed, scanned, tagged, released, and deployed to the Azure VM, which then
answered its health check from the public internet.

```
https://velchat.duckdns.org/health                200  {"status":"ok","service":"velchat-mono", ...}
https://velchat.duckdns.org/docs-json             200  full OpenAPI document, 185 routes
https://velchat.duckdns.org/status/feed/<id>      401  unauthenticated — the guard is live
  … same route with a valid bearer token         200  {"success":true,"data":[]}
wss://velchat.duckdns.org/ws?token=<token>        101  then {"type":"connected","connId":"…"}
```

The box runs `ghcr.io/aayushajs/velchat-velchat-mono:8.0.0`, pulled from the registry by the deploy
job — not a locally built image.

Getting there surfaced six defects, none of which review had caught, and four of which only appear
when something actually runs:

1. Every Dockerfile ran `pnpm -r build`, which got the build order wrong on a clean tree. The repo's
   own root script is `turbo run build`, and `turbo.json` declares `dependsOn: ["^build"]`, so
   turbo builds a library before whatever imports it. All seven now run `pnpm build`.
2. `.dockerignore` excluded `**/dist` but **not** `tsconfig.tsbuildinfo`. Since
   `tsconfig.base.json` sets `"incremental": true`, the stale build state told `tsc` everything was
   already emitted while no output existed, so `@velchat/crypto` and `@velchat/feature-contracts`
   silently produced nothing and every package importing them failed to resolve. Build state must
   never enter an image; it is excluded now.
3. `--frozen-lockfile` was proven safe rather than assumed — the install step succeeds, so all
   seven Dockerfiles now use it and the images are reproducible.

The result builds (exit 0), boots, serves `/health`, and the container's `HEALTHCHECK` reports
`healthy`. What is still unproven is everything that needs GitHub: the workflows themselves, GHCR
push, cosign signing, and the SSH deploy.

## Known gaps

- **Production is not always-on.** The deploy deallocates the VM when it started it, so the site is
  down between deploys. Correct for a demo box, wrong for one serving clients.
- **Each image rebuilds the whole monorepo.** A shared base image with seven thin images on top
  would cut release build time roughly sevenfold. The matrix runs in parallel so wall-clock is
  acceptable, but it is seven times the Actions minutes.
- **Only `velchat-mono` is exercised on pull requests.** The other six Dockerfiles are structurally
  identical and hadolint covers all seven, but only the release build proves them.
- **`UPSTREAM_STATUS` is undocumented** in the env contract. Harmless under `axis6`, where the
  `STATUS → CONTENT` topology mapping covers it; a `full13` deployment needs it set.
- **Two timing-sensitive suites flake under parallel load** (`feature-realtime/ws-fabric.spec.ts`,
  occasionally `feature-auth`). They pass when their package runs alone. Re-run the package before
  assuming a break.
