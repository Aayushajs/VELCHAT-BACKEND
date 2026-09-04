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
| **development** | `dev` | `https://velchat-edge-gateway-2aje.onrender.com` | yes, Render terminates it |

```
GET  http://20.219.132.21/health                 production
GET  https://velchat-edge-gateway-2aje.onrender.com/health   development
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

> Render appends a random suffix when a service name is taken, hence `-2aje`. The blueprint
> resolves upstreams with `fromService`, so the suffix never has to be hardcoded anywhere.

Both environments accept deployments only from their own branch, enforced as GitHub environment
branch policies: `production` ← `main`, `development` ← `dev`.

> GitHub's repo-home Deployments panel is **not** branch-filtered. It lists every environment
> whatever branch you are viewing, and no setting changes that — open the Deployments page and pick
> an environment in the left sidebar for a filtered view. Render also creates its own
> `dev - velchat-<service>` environment per service; that naming is Render's, not ours.

WebSocket endpoints, once TLS exists:

```
wss://<your-domain>/ws                                  production (needs a DNS name first)
wss://velchat-realtime-service-2aje.onrender.com/ws     development
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

Live. Six services on `dev`, rebuilt from source by Render on every push:

```
velchat-edge-gateway-2aje       ← the only one clients talk to
velchat-identity-service-2aje
velchat-messaging-service-2aje
velchat-realtime-service-2aje
velchat-content-service-2aje
velchat-platform-service-2aje
```

Credentials live in the Render **Env Group `velchat-shared`**, not in the blueprint. The names that
matter, because getting them wrong fails at boot rather than at build:

| Variable | Note |
| --- | --- |
| `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM` | **`_PEM`, not `_KEY`.** Config reads `_PEM`; nothing reads `_KEY`, so setting the wrong name looks right and every service refuses to boot with "JWT_PUBLIC_PEM is not set". Dev uses its own pair, not production's. |
| `POSTGRES_URL` · `MONGO_URL` · `CLOUDINARY_URL` | same providers as production |
| `VALKEY_URL` | **Upstash** — Render has no local container. See the note in [CI-CD.md](CI-CD.md) about the free command quota. |

Everything else (`SMTP_URL`, `MAIL_*`, `OTEL_*`) is optional; unset just means a safe fallback.

After a push to `dev`, CI polls the gateway's `/health` and records a `development` deployment once
Render is actually serving — it polls rather than assuming, because a record that turns green
without checking would be worse than none. The URL comes from the `RENDER_BASE_URL` variable.

**Cold starts are normal.** Free services sleep after ~15 minutes idle, and waking six of them can
take a minute. A `000`/timeout on first request is a cold start, not an outage — retry before
diagnosing.

If Render ever needs rebuilding from scratch: delete the Blueprint **and** its services (deleting
the blueprint alone orphans them), then **New → Blueprint** against this repo. `render.yaml`
describes six services pinned to `branch: dev`.

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
