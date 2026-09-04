# Runbook

Every operation, start to finish, in the order you would actually do it. If you only read one
document, read this one.

Companions: [`CI-CD.md`](CI-CD.md) explains *why* the pipeline is shaped the way it is;
[`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md) is the one-time setup;
[`PROJECT-STATE.md`](PROJECT-STATE.md) is what is in flight and what is known-broken.

---

## 0. What exists right now

| | |
| --- | --- |
| Branches | `main` (production → Azure) and `dev` (development → Render). Nothing else. |
| Live | `http://20.219.132.21/health` → `200` |
| Latest release | `v8.0.0` — seven signed images on GHCR |
| VM | `velchat-vm`, Central India, B2as_v2 (2 vCPU / 8 GB), **static** IP `20.219.132.21` |
| Auto-shutdown | **19:30 IST daily.** The box is off outside working hours; start it before you expect it to answer. |
| TLS | none yet — no DNS name, so Caddy serves plain HTTP |

---

## 0b. Base URLs

Clients only ever talk to the **edge gateway**. It routes to whichever service owns the path, so
there is one base URL per environment, not one per service.

| Environment | Branch | Base URL | TLS |
| --- | --- | --- | --- |
| **production** | `main` | `http://20.219.132.21` | none yet — see §5 |
| **development** | `dev` | `https://velchat-edge-gateway.onrender.com` | yes, Render terminates it |

```
GET  http://20.219.132.21/health                 production
GET  https://velchat-edge-gateway.onrender.com/health   development
```

Two differences worth knowing before you point a client at either:

- **Production is plain HTTP.** No DNS name yet, so there is no certificate. Browsers and mobile
  apps will refuse `ws://` for the realtime socket. §5 fixes this in about two minutes.
- **Development runs the six-service topology; production runs one process.** Same code assembled
  differently (`SPLIT_PROFILE=axis6` vs `mono`), so behaviour matches — but on Render each service
  has its own hostname, and the gateway's `UPSTREAM_*` variables point at them. Only the gateway
  URL is a client concern.

Render free services sleep after ~15 minutes idle, so the first request after a quiet period takes
several seconds. That is a cold start, not an outage.

> Render is **not deploying `dev` yet** — it is still on the old 13-service blueprint from `main`,
> so the URL above will not answer until the blueprint is synced. See §6.

WebSocket endpoints, once TLS exists:

```
wss://<your-domain>/ws                            production
wss://velchat-realtime-service.onrender.com/ws     development
```

---

## 1. Daily loop

```bash
pnpm vm start      # the box is auto-shut-down at 19:30 every day
pnpm vm status     # power state, IP, running containers

# ... work ...

pnpm vm stop       # DEALLOCATES — this is what actually stops the billing meter
```

`az vm stop` leaves the VM allocated and still charging. `pnpm vm stop` runs `az vm deallocate`
instead, deliberately. Leaving it running costs roughly **$36/month**; stopping it when you finish
brings that to about **$15/month**, and the $100 student credit stretches from ~2.8 months to ~7.

If a command hangs or says it cannot reach the host, the box is almost certainly deallocated.

---

## 2. Shipping a change

```bash
git checkout dev
# ... edit ...
git add -A
git commit -m "feat(feature-status): add the tray endpoint"
git push origin dev
```

The commit message decides the next version, so it is not cosmetic:

| Prefix | Bump | From `8.0.0` |
| --- | --- | --- |
| `fix:` `perf:` `revert:` | patch | `8.0.1` |
| `feat:` | minor | `8.1.0` |
| `feat!:` or a `BREAKING CHANGE:` body | major | `9.0.0` |
| `docs:` `chore:` `test:` `refactor:` `style:` | none | **no release, no deploy** |

Scope must come from the commitlint enum — `feature-status`, `feature-auth`, `composition`,
`edge-gateway`, `database`, `deploy`, `docs`, `ci`, … `status` is **not** valid. A husky hook runs
repo-wide lint and `format:check` on commit, so a commit can take **over two minutes**. Let it
finish; never pass `--no-verify`.

Pushing to `dev` runs CI: lint, typecheck, test, build, proto compatibility, Trivy, hadolint, and
one image build.

### Promoting to production

```bash
gh pr create --base main --head dev --title "..." --body "..."
gh pr checks --watch          # wait for green
gh pr merge --merge
```

The merge triggers `release.yml`, which does all of this on its own:

```
version   →  next semver from the commit messages since the last v* tag
images    →  build 7 → push to GHCR → cosign sign → attest → Trivy scan
publish   →  create the tag → GitHub Release with generated notes
deploy    →  start the VM if needed → ship compose → pull → up -d → smoke-check → stop it again
```

### What the deploy does to the VM

It leaves the box in the state it found it:

| VM before the deploy | After |
| --- | --- |
| **deallocated** | started, deployed to, then **deallocated again** |
| **already running** | deployed to, **left running** |

The second row matters as much as the first: if the box is up, someone is working on it, and a
deploy is not a reason to pull it out from under them.

The deallocate step runs under `always()`, so it fires whether the deploy succeeded, failed, or was
cancelled — the mistake to design against is not "stop failed" but "stop was skipped because
something else broke". It records whether it started the VM *before* calling `az vm start`, so even
a failure during startup still triggers the shutdown. It retries three times and then reads the
power state back, failing loudly if the box is still running rather than reporting success and
leaving a meter ticking.

A B2as_v2 left on unnoticed costs roughly **$1.20 a day**, so this is the difference between the
credit lasting months and lasting weeks.

Images are pushed **before** the tag exists, so a failed build leaves no tag. Every tag in this
repository denotes something that actually built.

```bash
gh run watch $(gh run list --workflow=release.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')
```

---

## 3. Deploying by hand

Normally CI does this. When you need to do it yourself:

```bash
pnpm vm deploy            # pull + restart at whatever TAG the env file says
pnpm vm deploy 8.0.0      # pin an exact version
pnpm vm health            # hit /health from inside the box
pnpm vm logs              # follow all containers
pnpm vm logs velchat-mono # follow one
```

### Rolling back

Every release is an immutable tag, so a rollback is choosing an older one:

```bash
pnpm vm deploy 7.0.0
```

To make it stick across the next CI run, pin it on the box:

```bash
pnpm vm ssh
sed -i 's/^TAG=.*/TAG=7.0.0/' ~/velchat.env
```

Migrations are expand/contract by policy, so the previous image keeps working against the newer
schema. That is what makes a rollback safe without touching the database.

---

## 4. Database migrations

Not automatic — run them yourself before deploying a release that adds one:

```bash
POSTGRES_URL='<the Neon URL from ~/velchat.env>' pnpm --filter @velchat/migrations migrate
```

**This has not been run yet against the Neon database.** Do it before expecting anything that
touches Postgres to work.

---

## 5. Adding TLS — the one real gap

Right now `DOMAIN=:80` and Caddy serves plain HTTP. The REST API works. The **mobile client will
not connect**, because it needs `wss://`.

Any free hostname fixes it:

- **DuckDNS** — duckdns.org, sign in with GitHub, pick a name, paste `20.219.132.21`
- **nip.io** — no signup at all: `20.219.132.21.nip.io` already resolves

Then:

```bash
pnpm vm ssh
sed -i 's/^DOMAIN=.*/DOMAIN=velchat.duckdns.org/' ~/velchat.env
sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=https://velchat.duckdns.org|' ~/velchat.env
sed -i 's|^JWT_ISSUER=.*|JWT_ISSUER=https://velchat.duckdns.org|' ~/velchat.env
cd ~/velchat-deploy/azure && docker compose --env-file ~/velchat.env up -d
exit

gh variable set AZURE_PUBLIC_URL --body "https://velchat.duckdns.org"
```

Caddy requests the certificate on startup, so **the name must resolve before you restart** or the
request fails. Verify:

```bash
curl https://velchat.duckdns.org/health
```

---

## 6. Render — the dev environment

**Outstanding. Until this is done, `dev` has no deployment.**

Render is connected to the **old 13-service blueprint on `main`**. In the repo's Deployments
sidebar that shows as thirteen `main - velchat-*` environments, named for services that stopped
existing at the 6-service consolidation — and they rebuild on every push to `main`, building a
topology this repo no longer has.

`render.yaml` here describes six services, each pinned to `branch: dev`. Render does not re-read a
blueprint on its own, and syncing an existing one tends to leave the old services orphaned rather
than removing them. Deleting and recreating is cleaner:

1. **Render dashboard → the existing Blueprint → Delete.**
2. **Delete the thirteen stale services** (`velchat-api-gateway`, `velchat-ai-service`,
   `velchat-auth-service`, and so on). Deleting the blueprint does not remove them.
3. **New → Blueprint → connect `Aayushajs/VELCHAT-BACKEND`.** It reads the current `render.yaml`:
   six services, each on `dev`.
4. **Env Groups → `velchat-shared`** → fill in `POSTGRES_URL`, `MONGO_URL`, `VALKEY_URL`,
   `CLOUDINARY_URL`. The same values the VM uses are in `~/velchat.env`.
5. Once `https://velchat-edge-gateway.onrender.com/health` answers, activate the deployment record:

   ```bash
   gh variable set RENDER_BASE_URL --body "https://velchat-edge-gateway.onrender.com"
   ```

### Why that last step exists

Render names its own environments `<branch> - <service>`, so after step 3 you get six
`dev - velchat-*` entries. It never writes to GitHub's `development` environment, which is why
creating one by hand does nothing on its own.

The `development` job in `ci.yml` fills that gap: on a push to `dev` it polls the Render gateway's
`/health` and records a `development` deployment once Render is actually serving. That gives one
clean entry per branch — `production` for `main`, `development` for `dev` — instead of six per-service
rows. It stays inert until `RENDER_BASE_URL` is set, so it produces no failures before Render works.

It polls rather than assuming: a deployment record that turns green without checking anything would
be worse than not having one.

### One caveat on Render's free tier

Services sleep after ~15 minutes idle and cold-start on the next request, and the free managed
datastores are metered. Upstash in particular allows 500k Redis commands/month, which the event bus
alone can exhaust in about a day — which is why the **Azure box runs Valkey locally** rather than
pointing at Upstash. Keep that difference in mind when dev behaves differently from production.

## 7. Secrets and where they live

| Where | What | Reachable by |
| --- | --- | --- |
| `~/.ssh/velchat-vm_key` (your machine) | VM private key | you |
| `deploy/azure/.vmrc` (gitignored) | resource group, VM name, key path, IP | `pnpm vm` |
| `~/velchat.env` (**on the VM**) | database URLs, JWT keypair, `INTERNAL_API_SECRET`, provider keys | the containers |
| GitHub repository secrets | `AZURE_HOST`, `AZURE_USER`, `AZURE_SSH_KEY`, `AZURE_SSH_HOST_KEY` | the deploy job |
| GitHub repository **variable** | `AZURE_PUBLIC_URL` | `environment.url` and the smoke check |

The VM's `.env` never passes through CI. A workflow run has no access to production database
credentials — it only ships the compose file and an image tag.

`AZURE_PUBLIC_URL` is a **variable**, not a secret, because GitHub rejects the `secrets` context in
`environment.url` and an invalid workflow file fails on every branch.

### Rotating the SSH key

The current key was pasted into a chat, so rotating it is worth doing when convenient:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/velchat-vm_key_new -C velchat-vm
```

Azure portal → the VM → **Reset password** → *SSH public key* → paste
`~/.ssh/velchat-vm_key_new.pub`. Then:

```bash
sed -i 's|^AZ_SSH_KEY=.*|AZ_SSH_KEY=/c/Users/ACER/.ssh/velchat-vm_key_new|' deploy/azure/.vmrc
gh secret set AZURE_SSH_KEY < ~/.ssh/velchat-vm_key_new
pnpm vm ssh   # confirm it works, then delete the old key
```

---

## 8. When something is wrong

| Symptom | First thing to check |
| --- | --- |
| `pnpm vm` anything hangs or "cannot reach" | The box is deallocated. `pnpm vm start`. |
| `/health` times out from outside | `pnpm vm health` — if that works, it is Caddy or the security group, not the app. |
| Release ran but no tag | The commits were all `docs:`/`chore:`. That is correct behaviour: no releasable change, no release. |
| Release failed on Trivy | A CRITICAL CVE **with a fix available**. Read the table in the log; it names the package and the fixed version. |
| Every branch shows a failed `release` run at 0s | The workflow file is invalid. GitHub reports that on all branches, not just the one that triggers it. |
| Deploy succeeded but the site is unchanged | Check what is actually running: `docker inspect velchat-velchat-mono-1 --format '{{.Config.Image}}'`. |
| Container restarts in a loop | `pnpm vm logs velchat-mono`. A missing required env var and a bad database URL both look like this. |

Useful directly on the box:

```bash
pnpm vm ssh
cd ~/velchat-deploy/azure
docker compose --env-file ~/velchat.env ps
docker compose --env-file ~/velchat.env logs --tail=100 velchat-mono
docker stats --no-stream          # is 8 GB actually enough?
```

---

## 9. Layout on the VM

```
~/velchat.env                        the real environment — never leaves the box
~/velchat-deploy/azure/compose.yml   shipped by CI on every deploy
~/velchat-deploy/azure/.env          symlink → ~/velchat.env
~/velchat-deploy/shared/Caddyfile    shipped by CI on every deploy
~/jwt.key                            the RS256 signing key, generated here
```

The directory structure mirrors the repo on purpose: `compose.yml` mounts `../shared/Caddyfile`, a
path relative to its own directory. Flattening both into `~` resolves to `/home/shared`, and Caddy
refuses to start.

---

## 10. Verifying a release is genuine

Images are signed by **digest**, not tag — a tag can be repointed at different bytes later, a
digest cannot:

```bash
cosign verify ghcr.io/aayushajs/velchat-velchat-mono:8.0.0 \
  --certificate-identity-regexp "^https://github.com/Aayushajs/VELCHAT-BACKEND/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Each image also carries an SBOM and build provenance, attached in the registry rather than left in
a CI log.
