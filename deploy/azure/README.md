# VelChat on Azure

**Free allowance:** `B1S` (1 vCPU / 1 GB) or `B2pts v2` (2 vCPU ARM / 1 GB), 750 h/month for
12 months. **Azure for Students** adds **$100 of credit for 12 months, no credit card, renewable
yearly** while you remain eligible.

## Profile — and why it differs

`SPLIT_PROFILE=mono`. 1 GB is the binding constraint: six Node processes are ~900 MB before the OS
gets anything, so this target runs **`velchat-mono`** — every feature group in a single process.

It is not a different application. It mounts the same `FeatureGroup` values the six services mount,
through the same assembler in `@velchat/composition`, so wiring order and behaviour are identical.
Only the process count changes, and changing back is a profile switch.

Footprint on a 1 GB box:

|                |                                      |
| -------------- | ------------------------------------ |
| `velchat-mono` | ~250 MB (heap capped at 320 MB)      |
| Valkey         | ~60 MB — local on purpose; see below |
| Caddy          | ~30 MB                               |
| **Total**      | **~340 MB**, leaving room for the OS |

## Spend the credit on data, not compute

Keep compute inside the free allowance and let the $100 cover managed data services:

|          | Choice                                                                                                  | Why                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres | Azure Database for PostgreSQL (credit), or Neon free                                                    | no free Azure Postgres tier                                                                                                                 |
| Mongo    | **Cosmos DB for MongoDB, free tier** (enable at account creation — one per subscription), or Atlas free | Cosmos speaks the Mongo wire protocol                                                                                                       |
| Redis    | **local Valkey container**                                                                              | Azure Cache for Redis has no free tier, and a metered Redis is the worst home for the event bus — Redis Streams consumers read continuously |
| Blobs    | Azure Blob via the `azure-blob` adapter                                                                 | Blob is **not** S3-compatible, so it has its own adapter                                                                                    |

## Deploy

```bash
# B1S, Ubuntu 22.04
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER" && newgrp docker

git clone <your-repo> velchat && cd velchat
cp deploy/azure/.env.example deploy/azure/.env
docker compose -f deploy/azure/compose.yml --env-file deploy/azure/.env up -d
```

Verify:

```bash
curl -s localhost:3000/health
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/chat/conversations/x/messages   # 401
docker stats --no-stream                                    # confirm you are under ~500 MB
```

## Storage adapter

Azure Blob is the one target that does not speak S3, so it gets a dedicated adapter
(`libs/storage/src/adapters/azure-blob.storage.ts`) written against the Blob REST API with Shared
Key auth. It deliberately avoids `@azure/storage-blob`: the signing scheme is a few dozen lines of
HMAC that node's crypto already covers, and an SDK would add a dependency and a second HTTP stack
for no capability gain. Downloads are served by short-lived, **read-only, blob-scoped** SAS URLs.

## Trade-offs, stated plainly

- **One process = one blast radius.** A crash takes every feature with it. Right for a 1 GB box or a
  staging environment; wrong once traffic justifies six services.
- **One scaling axis.** You cannot scale sockets independently of message writes in `mono`.
- **The free window is 12 months** (credit renewable while you are a student). Oracle Always Free is
  the only indefinitely-free home.

A reasonable product setup: **Oracle Always Free for production, Azure for Students for
staging/CI** — two independent clouds, both at ₹0, and the same images on each.
