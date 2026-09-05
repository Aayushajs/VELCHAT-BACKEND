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
| Live | `https://velchat.duckdns.org/health` → `200` |
| Latest release | `v8.0.0` — seven signed images on GHCR |
| VM | `velchat-vm`, Central India, B2as_v2 (2 vCPU / 8 GB), **static** IP `20.219.132.21` |
| Auto-shutdown | **19:30 IST daily.** The box is off outside working hours; start it before you expect it to answer. |
| TLS | yes — `velchat.duckdns.org`, Let's Encrypt via Caddy |

---

## 0b. Base URLs

Clients only ever talk to the **edge gateway**. It routes to whichever service owns the path, so
there is one base URL per environment — not one per service.

| | production | development |
| --- | --- | --- |
| Branch | `main` | `dev` |
| Base URL | `https://velchat.duckdns.org` | `https://velchat-edge-gateway-2aje.onrender.com` |
| WebSocket | `wss://velchat.duckdns.org/ws` | `wss://velchat-edge-gateway-2aje.onrender.com/ws` |
| Swagger UI | `https://velchat.duckdns.org/docs` | `…onrender.com/docs` |
| OpenAPI JSON | `https://velchat.duckdns.org/docs-json` | `…onrender.com/docs-json` |
| TLS | Let's Encrypt, via Caddy | Render terminates it |
| Topology | `mono` — one process | `axis6` — six services |
| Availability | only while the VM is running | sleeps after ~15 min idle |

### Individual Render services

Only the gateway is a client concern. These are for debugging one service directly:

```
https://velchat-edge-gateway-2aje.onrender.com        the one clients use
https://velchat-identity-service-2aje.onrender.com    auth · users · orgs · channels
https://velchat-messaging-service-2aje.onrender.com   chat · notifications · search
https://velchat-realtime-service-2aje.onrender.com    presence · the WebSocket fabric
https://velchat-content-service-2aje.onrender.com     media · status/stories
https://velchat-platform-service-2aje.onrender.com    calls · automation · AI
```

Render appends a random suffix when a service name is taken, hence `-2aje`. The blueprint resolves
upstreams with `fromService`, so that suffix is never hardcoded anywhere — do not copy it into
config.

Production has no equivalent list: `mono` runs every feature group in one process behind one URL.

### Checking an environment

Everything below is verified working against production. Substitute the dev base URL to check
Render instead.

**Is it up?**

```bash
curl https://velchat.duckdns.org/health    # {"status":"ok","service":"velchat-mono",...}
curl https://velchat.duckdns.org/ready     # {"status":"ready"}
```

**Is TLS real, and does HTTP redirect?**

```bash
curl -sI http://velchat.duckdns.org/health | head -1        # 308
echo | openssl s_client -connect velchat.duckdns.org:443   -servername velchat.duckdns.org 2>/dev/null   | openssl x509 -noout -issuer -enddate                    # Let's Encrypt + expiry
```

**Is the API actually serving?** `/docs-json` returns the full OpenAPI document — 185 routes — so a
200 with a large body proves the app is answering, not just the proxy.

```bash
curl -s https://velchat.duckdns.org/docs-json | head -c 200
```

**Is the auth guard live?** An unauthenticated call to a guarded route must be rejected. A `404`
here would mean the route is missing; `401` is the correct answer.

```bash
curl -s https://velchat.duckdns.org/status/feed/00000000-0000-0000-0000-000000000000
# {"success":false,"statusCode":401,"message":"Missing access token",...}
```

**Does an authenticated call work?** Mint a token with the running key. It needs `account_id`,
`device_id` **and `iss` matching `JWT_ISSUER`** — the guard checks the issuer, and a token without
it is rejected exactly like an invalid one, which is an easy way to misdiagnose a working system.

```bash
pnpm vm ssh
docker exec velchat-velchat-mono-1 node -e '
  const jwt = require("/repo/node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken");
  const priv = process.env.JWT_PRIVATE_PEM;          // config normalises the escapes
  console.log(jwt.sign(
    { account_id: "00000000-0000-0000-0000-0000000000aa",
      device_id:  "00000000-0000-0000-0000-0000000000bb", scope: "access" },
    priv, { algorithm: "RS256", expiresIn: 300, issuer: process.env.JWT_ISSUER }));'
```

```bash
curl -s -H "Authorization: Bearer <token>"   https://velchat.duckdns.org/status/feed/00000000-0000-0000-0000-0000000000aa
# {"success":true,"statusCode":200,"data":[]}
```

**Does the WebSocket work?** The token goes in `?token=` or an `Authorization` header. A correct
connection answers with a `connected` frame carrying its connection id; a rejected one closes with
code `4001`.

```bash
node -e '
  const WebSocket = require("ws");
  const ws = new WebSocket("wss://velchat.duckdns.org/ws?token=" + process.argv[1]);
  ws.on("open",    () => console.log("open"));
  ws.on("message", (d) => { console.log(d.toString()); process.exit(0); });
  ws.on("close",   (c) => console.log("closed", c));' "<token>"
# {"kind":"durable","type":"connected","data":{"connId":"…"}}
```

> A `000` or timeout against **development** is almost always a cold start — Render sleeps free
> services after ~15 minutes and waking six of them takes up to a minute. Retry before diagnosing.
> Against **production**, it means the VM is deallocated: `pnpm vm start`.

Both environments accept deployments only from their own branch, enforced as GitHub environment
branch policies: `production` ← `main`, `development` ← `dev`.

> GitHub's repo-home Deployments panel is **not** branch-filtered. It lists every environment
> whatever branch you are viewing, and no setting changes that — open the Deployments page and pick
> an environment in the left sidebar for a filtered view. Render also creates its own
> `dev - velchat-<service>` environment per service; that naming is Render's, not ours.

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

## 5. TLS

Done. `velchat.duckdns.org` points at the VM, and Caddy holds a Let's Encrypt certificate it
renews on its own. Plain HTTP is 308-redirected to HTTPS, and `wss://velchat.duckdns.org/ws`
completes the WebSocket upgrade, so the mobile client can connect.

```
https://velchat.duckdns.org/health   200
http://velchat.duckdns.org/health    308 -> https
issuer                               Let's Encrypt
```

### Changing the hostname

Three values move together — the domain Caddy serves, the CORS origin, and the token issuer:

```bash
pnpm vm ssh
cd ~
sed -i 's|^DOMAIN=.*|DOMAIN=<new-host>|'                    velchat.env
sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=https://<new-host>|' velchat.env
sed -i 's|^JWT_ISSUER=.*|JWT_ISSUER=https://<new-host>|'     velchat.env
cd ~/velchat-deploy/azure && docker compose --env-file ~/velchat.env up -d
exit

gh variable set AZURE_PUBLIC_URL --body "https://<new-host>"
```

**The name must resolve before the restart.** Caddy requests the certificate on startup, and a
name that does not yet resolve fails the ACME challenge — then it backs off, so a premature restart
costs you a wait rather than just an error.

Changing `JWT_ISSUER` invalidates tokens signed under the old issuer, so everyone signs in again.
That is the correct behaviour, not a bug, but do it deliberately.

### Renewal

Caddy renews automatically at roughly two-thirds of the certificate's life and stores state in the
`caddydata` volume, which survives `docker compose up -d`. Renewal needs **port 80 reachable** —
if the security group is ever tightened to 443 only, renewal silently fails and the certificate
expires ~60 days later.

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
