# Deploying VelChat free: Oracle, AWS, Azure (and Render)

The same container images and the same environment contract run on all four. Nothing in `apps/**`
or `libs/**` imports a cloud SDK — every cloud-specific choice is an adapter selected by an env
var, so moving clouds is a configuration change, not a port.

What is _not_ the same is how much free compute each cloud gives you. That difference is large
enough to change how many processes you run, so read §2 before picking a target.

---

## 1. What is actually free (verified, not assumed)

|                       | Oracle Cloud                                  | AWS                                                                               | Azure                                                              |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Free compute          | `VM.Standard.A1.Flex` ARM, **2 OCPU / 12 GB** | `t4g.small` ARM, 2 vCPU / **2 GB**, 750 h/mo                                      | `B1S` 1 vCPU / **1 GB**, or `B2pts v2` ARM 2 vCPU / 1 GB, 750 h/mo |
| How long              | **Forever** (Always Free)                     | Until **31 Dec 2026** (T4g free trial)                                            | **12 months**                                                      |
| New-account credits   | $300 / 30 days (this design uses none)        | $100–$200 credits, no legacy 12-month tier for accounts created after 15 Jul 2025 | $200 / 30 days                                                     |
| Block storage         | 200 GB                                        | 30 GB gp2/gp3 (12-month accounts)                                                 | 2 × 64 GB P6 SSD (12 months)                                       |
| Object storage        | 20 GB, S3-compatible API                      | 5 GB S3 (12 months)                                                               | 5 GB Blob (12 months)                                              |
| Egress                | 10 TB/month                                   | 100 GB/month                                                                      | 100 GB/month                                                       |
| After the free window | Compute stays free                            | Compute is billed                                                                 | Compute is billed                                                  |

Sources: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) ·
[Oracle A1 allocation change](https://community.oracle.com/customerconnect/discussion/970310/oci-always-free-updated-ampere-a1-compute-allocation) ·
[EC2 T4g free trial](https://repost.aws/articles/ARi_gf6vo6TuqNtMQdiYPKyA/announcing-amazon-ec2-t4g-free-trial-extension) ·
[AWS Free Tier FAQ](https://aws.amazon.com/free/legacy/free-tier-faqs) ·
[Azure free services](https://azure.microsoft.com/en-us/pricing/free-services)

**The honest conclusion:** only Oracle offers permanently-free compute, and it offers 6× the RAM of
AWS free and 12× of Azure free. Oracle is therefore the primary target; AWS and Azure are supported
as portability destinations and as time-boxed alternatives, not as indefinite hosts.

---

## 2. Pick a profile from the RAM you actually have

The stack has two dials. `SPLIT_PROFILE` decides how many processes; `infra-context` decides which
datastores each process opens. Together they let one codebase fit very different boxes.

| Profile                       | Fits                   | Processes          | Data tier                          | RAM                        |
| ----------------------------- | ---------------------- | ------------------ | ---------------------------------- | -------------------------- |
| **`axis6` + local stores**    | Oracle A1 (12 GB)      | 6 services + Caddy | Postgres, Mongo, Valkey on the box | ~2.5 GB idle, ~4.5 GB peak |
| **`axis6` + external stores** | AWS `t4g.small` (2 GB) | 6 services + Caddy | managed Postgres / Mongo / Redis   | ~0.9 GB                    |
| **`full13`**                  | anything ≥ 12 GB       | 13 services        | any                                | rollback only              |

**Azure free (1 GB) does not fit any of these**, and this document will not pretend otherwise. Six
Node processes are ~0.9 GB before the OS, which leaves nothing. Azure is viable in one of two ways:

1. **Azure as a portability proof, not a host** — build and deploy to AKS or Container Apps and pay
   for what you use. The Helm values in `deploy/helm/values/` work unchanged.
2. **Azure free with fewer processes** — this needs a `mono` split profile (all features in one
   process) that is _not yet implemented_. `topology.ts` currently ships `axis6` and `full13` only.
   Adding it is a small, well-bounded change: one more mapping in `topology.ts` plus a composition
   root that mounts every feature lib. It is deliberately left undone rather than half-done.

---

## 3. Per-cloud setup

### 3.1 Oracle Cloud Always Free — primary

Full runbook: [`deploy/oracle/README.md`](./oracle/README.md).

```bash
cp deploy/oracle/.env.example deploy/oracle/.env     # fill passwords, JWT keypair, S3 keys, DOMAIN
docker compose -f deploy/oracle/compose.yml --env-file deploy/oracle/.env up -d
```

Oracle specifics that matter:

- **Home region is permanent** and Always Free compute only exists there. `ap-mumbai-1` is the
  choice for India-wide latency.
- **`STORAGE_PROVIDER=s3`** — Oracle Object Storage speaks the S3 API, so the existing adapter works
  with no code change. Create a _Customer Secret Key_ in the OCI console for the access/secret pair.
- **A1 capacity** is frequently exhausted; `deploy/oracle/scripts/launch-retry.sh` loops until it succeeds.
- **Idle reclamation** can take the instance away. That is not preventable inside Always Free, so
  the answer is tested recovery — see §4.4 of the design spec.

### 3.2 AWS — `t4g.small`, until Dec 2026

Same images (they are built `linux/arm64` + `linux/amd64`, and t4g is Graviton/ARM).

```bash
# 2 GB box: run the services, but NOT the databases.
STORAGE_PROVIDER=s3            # S3 proper; only the endpoint/region differ from Oracle
S3_ENDPOINT=                   # leave empty for real AWS S3
S3_REGION=ap-south-1
POSTGRES_URL=<managed Postgres>
MONGO_URL=<managed Mongo>
VALKEY_URL=<managed Redis>
```

Zero code change: the `s3` adapter is the same one Oracle uses. For Kubernetes use
`deploy/helm/values/` against EKS.

### 3.3 Azure

One adapter gap, stated plainly: **Azure Blob Storage is not S3-compatible**, so
`STORAGE_PROVIDER=s3` will not talk to it. Two options:

- add an `azure-blob` adapter beside the existing `cloudinary` and `s3` ones in `libs/storage`
  (~100 lines, the port is already defined in `storage.port.ts`); or
- put MinIO in front of Blob in S3-gateway mode and keep `STORAGE_PROVIDER=s3`.

Everything else — Postgres, Mongo, Redis, the event bus, the JWT contract — is unchanged.

### 3.4 Render — fallback

`render.yaml` deploys the six services on the free plan. Free web services sleep when idle, so cold
starts are user-visible, and the managed free datastores are metered: Upstash allows **500k Redis
commands/month**, which the event bus alone can exhaust in about a day. Useful for a demo, not for a
running product.

---

## 4. The portability contract

What makes all of the above a config change rather than a migration:

1. **12-factor env only.** No cloud SDK in application code; `libs/config` validates every variable
   at boot and fails closed.
2. **Ports and adapters.** `EVENT_BUS` (redis-streams | kafka), `STORAGE_PROVIDER`
   (cloudinary | s3 | _azure-blob, to add_), `SEARCH_PROVIDER` (atlas | opensearch). Adding a cloud
   means adding an adapter, never touching a feature.
3. **Multi-arch images.** Every Dockerfile builds `linux/arm64` (Oracle A1, AWS Graviton) and
   `linux/amd64` (Azure, x86).
4. **Two orchestrators, one image.** `deploy/oracle/compose.yml` for a VM;
   `deploy/helm/values/*.yaml` for EKS / AKS / OKE.
5. **`SPLIT_PROFILE`** decouples the public API from the process layout, so the same routes work
   whether they are served by 6 processes or 13.

## 5. Scaling later

The 6-service topology is a starting point, not a ceiling. In rough order:

1. **Vertical** — Oracle A1 to a paid shape; the compose file only needs its limits raised.
2. **Split a service back out** — set `UPSTREAM_<LOGICAL>` for the one service you want separated,
   or switch to `full13`. No feature code changes, because feature libs never import each other.
3. **Horizontal** — move to Kubernetes with the existing Helm values; `realtime-service` scales on
   connection count, `messaging-service` on write throughput, independently.
4. **Swap the event bus** — `EVENT_BUS=kafka` when Redis Streams stops keeping up.
5. **Cells** — Part G §3 of the architecture doc, for 1M+ concurrent connections.
