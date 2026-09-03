# Setup checklist

Everything that has to exist outside the code before `dev` and `main` deploy on their own. Work
top to bottom; each section says what breaks if you skip it.

---

## 1. Local — controlling the VM

The `pnpm vm` command wraps the Azure CLI and SSH so the box is managed from the terminal.

```bash
# Azure CLI (once)
winget install Microsoft.AzureCLI     # Windows
az login
```

Then create `deploy/azure/.vmrc` (gitignored) — this repo already has one matching the documented
VM:

```ini
AZ_RESOURCE_GROUP=velchat
AZ_VM_NAME=velchat-vm
AZ_SSH_USER=azureuser
AZ_SSH_KEY=/c/Users/<you>/.ssh/velchat-vm_key
AZ_SSH_PORT=22
# Optional: set this and the SSH commands work without the Azure CLI at all.
# AZ_HOST=4.213.x.x
```

The private key belongs in `~/.ssh/`, never in the repo — `.gitignore` blocks `id_rsa`, `*_key`,
`*.pem` and `*.key`, but the reliable rule is simply that a key never enters a git working tree.

| Command | What it does |
| --- | --- |
| `pnpm vm status` | power state, public IP, running containers |
| `pnpm vm start` / `pnpm vm stop` | **`stop` deallocates**, which is what actually stops billing |
| `pnpm vm setup` | one-time bootstrap: Docker, compose file, Caddyfile |
| `pnpm vm ssh` | shell on the box |
| `pnpm vm deploy [tag]` | pull images and restart |
| `pnpm vm logs [service]` | follow logs |
| `pnpm vm health` | hit `/health` from inside the VM |

> `az vm stop` leaves the VM allocated and still billing. `pnpm vm stop` runs `az vm deallocate`
> instead, deliberately.

---

## 2. Azure VM — one-time

```bash
pnpm vm setup      # installs Docker, copies compose.yml + Caddyfile
pnpm vm ssh        # then, on the box:
#   cp ~/velchat.env.example ~/velchat.env && nano ~/velchat.env
```

`~/velchat.env` holds the database URLs and `INTERNAL_API_SECRET`. It is created **on the VM** and
never passes through CI, so a workflow run has no access to production credentials.

Two settings on the VM itself, both easy to get wrong:

- **Public IP must be Static.** Auto-shutdown *deallocates* the VM, and a dynamic IP is released
  when that happens — you get a different address on restart, which silently breaks DNS and the
  `AZURE_HOST` secret every day.
- **Ports 80 and 443 must be open** in the network security group. Caddy binds both; without 80
  the Let's Encrypt HTTP-01 challenge cannot complete, so there is no certificate, and without 443
  nothing is reachable.

---

## 3. Databases — not included with the VM

The VM runs the app and Valkey. Postgres and Mongo are external.

| Need | Options | Env var |
| --- | --- | --- |
| PostgreSQL | Azure Database for PostgreSQL (uses credit), or Neon free | `POSTGRES_URL` |
| MongoDB | Cosmos DB for MongoDB free tier — **enable at account creation, one per subscription** — or Atlas M0 | `MONGO_URL` |
| Redis | none needed — Valkey runs locally in the compose file | `VALKEY_URL` |

Valkey stays on the box deliberately: it is ~60 MB, and a metered Redis is the worst possible home
for the event bus, whose Streams consumers read continuously.

Run the migrations once before the first deploy, and again after any release that adds one:

```bash
POSTGRES_URL=... pnpm --filter @velchat/migrations migrate
```

---

## 4. DNS — not done, and this is the one real gap

There is no DNS name yet, so `~/velchat.env` carries `DOMAIN=:80` and Caddy serves **plain HTTP**.
The REST API works over `http://20.219.132.21`, but the mobile client needs `wss://` and will not
connect until a hostname exists.

Any free name works — DuckDNS gives you `something.duckdns.org` in about two minutes, and
`20.219.132.21.nip.io` resolves with no signup at all. Point an `A` record at the VM, set `DOMAIN`
to that name in `~/velchat.env`, and restart. Caddy requests the certificate itself on startup, so
the name has to resolve **before** the restart or the request fails.

---

## 5. GitHub — repository secrets

**Settings → Secrets and variables → Actions.** `GITHUB_TOKEN` is provided automatically and
already covers pushing to GHCR; everything below is only for the deploy job.

These are all set already, along with the `production` environment and `write` workflow
permissions. The table is here so the setup can be reproduced, not because it is outstanding.

| Secret | Required | Value |
| --- | --- | --- |
| `AZURE_HOST` | yes | the VM's public IP or DNS name |
| `AZURE_USER` | yes | `azureuser` |
| `AZURE_SSH_KEY` | yes | the **private** key, full PEM including the BEGIN/END lines |
| `AZURE_PUBLIC_URL` | — | **A repository variable, not a secret.** GitHub rejects the `secrets` context in `environment.url`, and an invalid workflow file fails on every branch. Currently `http://20.219.132.21` |
| `AZURE_SSH_HOST_KEY` | recommended | output of `ssh-keyscan -H <ip>`; pins the host against MITM |
| `AZURE_SSH_PORT` | no | defaults to `22` |

Without these, build and release still work — only `deploy` fails.

### Optional: require approval before a deploy

**Settings → Environments → production → Required reviewers.** The `deploy` job already runs in
that environment, so adding a reviewer gates every deploy with no workflow change.

---

## 6. GHCR — package visibility

The first release creates seven packages under `ghcr.io/aayushajs/`. They inherit the repository's
visibility. If the repo is private, the VM needs to authenticate to pull them — the deploy workflow
does this with `GITHUB_TOKEN`, and `pnpm vm deploy` needs you to have run `docker login ghcr.io`
on the box once.

---

## 7. Render — the dev environment

**This still needs doing in the Render dashboard, and until it is done `dev` has no deployment.**

Render is currently connected to the **old 13-service blueprint on `main`**. That is visible in the
repo's Deployments sidebar as thirteen environments named `main - velchat-api-gateway`,
`main - velchat-ai-service` and so on — service names that stopped existing at the 6-service
consolidation. They redeploy on every push to `main`, building a topology the repo no longer has.

`render.yaml` in this repo now describes six services and pins each to `branch: dev`, but Render
does not re-read a blueprint on its own.

1. Render dashboard → the existing Blueprint → **Delete**.
2. **Delete the thirteen stale services** — removing the blueprint does not remove them.
3. **New → Blueprint** → connect the repo. It reads the current `render.yaml`: six services on `dev`.
4. Fill the `velchat-shared` env group with the same database URLs the VM uses.
5. Once the gateway answers, `gh variable set RENDER_BASE_URL --body https://velchat-edge-gateway.onrender.com`
   so CI records a `development` deployment per push.

Syncing the existing blueprint instead of recreating it tends to leave the old services orphaned,
which is why this deletes first. Full detail in [`RUNBOOK.md`](RUNBOOK.md) §6.

Two things worth knowing about how this shows up on GitHub:

- Render names its own environments `<branch> - <service>`, so once it tracks `dev` you will see
  `dev - velchat-edge-gateway` and friends. It never writes to a `development` environment, so
  creating one by hand does nothing.
- Render free services sleep after ~15 minutes idle. A cold start there is expected and is not a
  production signal.

---

## What runs when

| You do | What happens |
| --- | --- |
| Push to `dev` | CI verifies, Render rebuilds from source |
| Open a PR | CI verifies: lint, typecheck, test, build, proto compat, Trivy, hadolint, one image build |
| Merge to `main` | version → 7 signed images to GHCR → tag + GitHub Release → deploy to Azure → health check |
| `docs:`/`chore:` only merge | no version, no release, no deploy |

Version comes from the commit messages: `fix:` → patch, `feat:` → minor, `feat!:` or
`BREAKING CHANGE:` → major (capped to a minor bump while the major is still `0`).

---

## Verifying it worked

```bash
pnpm vm status                       # containers up?
pnpm vm health                       # /health from inside the box
curl https://<your-domain>/health    # through Caddy, with TLS

cosign verify ghcr.io/aayushajs/velchat-velchat-mono:<version> \
  --certificate-identity-regexp "^https://github.com/Aayushajs/VELCHAT-BACKEND/" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

## Cost notes

The documented VM is `B2as_v2` (2 vCPU / 8 GB) at ~$0.0492/hr — roughly **$36/month running
continuously**, which is about 2.8 months of the $100 student credit. It is *not* in the free tier;
`B1S` is (750 hrs/month for 12 months), which is why the compose file is tuned for 1 GB and uses
`SPLIT_PROFILE=mono`.

With auto-shutdown at 19:30 and a ~10 hr day that drops to roughly $15/month. `pnpm vm stop` when
you are done for the day is the other half of that — and it deallocates, so it genuinely stops the
meter.

With 8 GB the `--max-old-space-size=320` cap and the 480 MB container limit in
`deploy/azure/compose.yml` are far tighter than they need to be. Raise them, or move to
`SPLIT_PROFILE=axis6` and run the six services separately for parity with Render.
