# CI/CD

Two workflows. `ci.yml` guards every pull request; `release.yml` turns a merge to `main` into a
version, seven signed container images, a GitHub Release, and a running deployment.

---

## Environments

| Branch | Environment | Target | How it deploys |
| --- | --- | --- | --- |
| `dev` | development | **Render** (free tier, 6 services) | Render watches `dev` and builds from source on its own runners, via `render.yaml`. No images involved. |
| `main` | production | **Azure** B1S (`velchat-mono`) | `release.yml` versions the merge, publishes signed images to GHCR, then deploys them over SSH. |

Both branches run the full `ci.yml` on push, because both deploy from a push and neither should
deploy something unverified.

The two targets deliberately run different topologies — Render runs the six services
(`SPLIT_PROFILE=axis6`), Azure runs all feature groups in one process (`SPLIT_PROFILE=mono`,
because 1 GB cannot hold six Node processes). That is the same code assembled differently, not two
applications, so dev remains a fair test of production behaviour. Render free services also sleep
after ~15 minutes idle, so a cold start there is expected and is not a production signal.

## The pipeline

```text
pull request
   └─ ci.yml
        verify        lint · typecheck · build · test
        proto-compat  buf breaking-change check against main (§G7)
        security      Trivy fs scan (CRITICAL) · CycloneDX SBOM
        images        hadolint every Dockerfile · build velchat-mono (no push)

merge to main
   └─ release.yml
        version   ── derive the next semver from Conventional Commits
        images    ── build 7 images → push to GHCR → cosign sign → attest → Trivy scan
        publish   ── create the tag → GitHub Release with generated notes
        deploy    ── ship compose to the Azure VM → pull → up -d → smoke-check /health
```

Images are pushed **before** the tag is created. A failed build therefore leaves no tag and no
release, so every tag in this repository denotes something that actually built.

If a push to `main` contains no `feat`, `fix`, `perf`, `revert` or breaking commit — a docs-only or
`chore` merge — `version` reports `bump=none` and the remaining jobs are skipped. No empty release
is cut.

---

## Versioning

The version comes from the commit messages, so a merge produces a release without a second PR to
approve.

| Commit | Bump | Example |
| --- | --- | --- |
| `fix:` · `perf:` · `revert:` | patch | `0.1.2 → 0.1.3` |
| `feat:` | minor | `0.1.2 → 0.2.0` |
| `feat!:` or a `BREAKING CHANGE:` body | major | `1.4.0 → 2.0.0` |
| `docs:` · `chore:` · `test:` · `refactor:` · `style:` | none | no release |

**Pre-1.0 guard.** While the major is `0` the API is not declared stable, so a breaking change
bumps the *minor* (`0.4.1 → 0.5.0`) instead of declaring `1.0.0`. Whether a project is 1.0 is a
decision a human makes, not something a commit message should be able to trigger by accident. Tag
`v1.0.0` by hand when you mean it, and normal major bumps take over from there.

With no tag in the repository yet, the first version is seeded from the root `package.json` so the
first release cannot land behind the version the repo already advertises.

This replaced a Changesets flow. Changesets is the right tool for publishing many independently
versioned npm packages; this repo publishes **container images from one repo-wide version**, and
its "Version Packages" PR meant a release needed two merges instead of one.

---

## Images

Published to GHCR, which namespaces by repository **owner**:

```text
ghcr.io/velcart/velchat-velchat-mono         ← the 1 GB / Azure target
ghcr.io/velcart/velchat-edge-gateway
ghcr.io/velcart/velchat-identity-service
ghcr.io/velcart/velchat-messaging-service
ghcr.io/velcart/velchat-realtime-service
ghcr.io/velcart/velchat-content-service
ghcr.io/velcart/velchat-platform-service
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
cosign verify ghcr.io/velcart/velchat-velchat-mono:0.2.0 \
  --certificate-identity-regexp "^https://github.com/VELCART/VELCHAT-BACKEND/" \
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
curl -fsSL https://raw.githubusercontent.com/VELCART/VELCHAT-BACKEND/main/deploy/azure/.env.example \
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

## Known gaps

- **Image builds are not reproducible across the seven Dockerfiles.** Six of them run
  `pnpm install --frozen-lockfile=false`, which allows the dependency graph to drift at build time.
  Signing an image and publishing an SBOM for it both assume the opposite.
  `docker/velchat-mono.Dockerfile` uses `--frozen-lockfile`; the other six should follow.
- **Each image rebuilds the whole monorepo.** A shared base image carrying one `pnpm -r build`,
  with seven thin images on top, would cut release build time by roughly seven times. The matrix
  runs in parallel so wall-clock is acceptable today, but it is seven times the Actions minutes.
- **`UPSTREAM_STATUS` is undocumented** in the env contract. Harmless under `axis6`, where the
  `STATUS → CONTENT` topology mapping covers it, but a `full13` deployment needs it set.
