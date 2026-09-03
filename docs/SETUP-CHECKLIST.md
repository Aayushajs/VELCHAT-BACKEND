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

## 4. DNS

Point an `A` record at the VM's public IP **before** the first deploy. Caddy requests the
certificate on startup, and that request fails if the name does not yet resolve. Set the same name
as `DOMAIN` in `~/velchat.env`.

---

## 5. GitHub — repository secrets

**Settings → Secrets and variables → Actions.** `GITHUB_TOKEN` is provided automatically and
already covers pushing to GHCR; everything below is only for the deploy job.

| Secret | Required | Value |
| --- | --- | --- |
| `AZURE_HOST` | yes | the VM's public IP or DNS name |
| `AZURE_USER` | yes | `azureuser` |
| `AZURE_SSH_KEY` | yes | the **private** key, full PEM including the BEGIN/END lines |
| `AZURE_PUBLIC_URL` | yes | `https://<your-domain>`, for the post-deploy health check |
| `AZURE_SSH_HOST_KEY` | recommended | output of `ssh-keyscan -H <ip>`; pins the host against MITM |
| `AZURE_SSH_PORT` | no | defaults to `22` |

Without these, build and release still work — only `deploy` fails.

### Optional: require approval before a deploy

**Settings → Environments → production → Required reviewers.** The `deploy` job already runs in
that environment, so adding a reviewer gates every deploy with no workflow change.

---

## 6. GHCR — package visibility

The first release creates seven packages under `ghcr.io/velcart/`. They inherit the repository's
visibility. If the repo is private, the VM needs to authenticate to pull them — the deploy workflow
does this with `GITHUB_TOKEN`, and `pnpm vm deploy` needs you to have run `docker login ghcr.io`
on the box once.

---

## 7. Render — the dev environment

**New → Blueprint → connect the repo.** It reads `render.yaml`, which pins every service to the
`dev` branch. Then fill the `velchat-shared` env group with the same database URLs.

Render free services sleep after ~15 minutes idle, so a cold start there is expected and is not a
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

cosign verify ghcr.io/velcart/velchat-velchat-mono:<version> \
  --certificate-identity-regexp "^https://github.com/VELCART/VELCHAT-BACKEND/" \
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
