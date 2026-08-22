# VelChat on AWS

**Free window:** `t4g.small` (2 vCPU ARM / 2 GB), 750 h/month, **until 31 Dec 2026**. Accounts
created after 15 Jul 2025 get $100–$200 of credits instead of the legacy 12-month tier. Only Oracle
Always Free stays free indefinitely — see [`../PORTABILITY.md`](../PORTABILITY.md).

## Profile

`SPLIT_PROFILE=axis6` — all six services. 2 GB fits the processes (~900 MB) but **not** a local data
tier, so Postgres / Mongo / Redis are external.

## Deploy

```bash
# t4g.small, Amazon Linux 2023 or Ubuntu 22.04 arm64
sudo dnf install -y docker && sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" && newgrp docker

git clone <your-repo> velchat && cd velchat
cp deploy/aws/.env.example deploy/aws/.env     # fill POSTGRES_URL, MONGO_URL, VALKEY_URL, JWT keys
docker compose -f deploy/aws/compose.yml --env-file deploy/aws/.env up -d
```

Verify — each step rules out a different layer:

```bash
for p in 3001 3002 3004 3006 3008 3010; do curl -s localhost:$p/health; echo; done
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/chat/conversations/x/messages
# expect 401: the request reached messaging-service and its guard rejected it. 502 = routing.
```

## Notes

- **Images need no change.** t4g is Graviton (ARM) and every Dockerfile builds `linux/arm64`
  alongside `linux/amd64`.
- **Storage:** `STORAGE_PROVIDER=s3` with `S3_ENDPOINT` left empty → real AWS S3. The same adapter
  Oracle uses; only the endpoint and region differ.
- **Surplus CPU credits are billable** on t4g even during the free trial. Watch CPU credit balance
  if you run sustained load.
- **Kubernetes:** `deploy/helm/values/*.yaml` work against EKS unchanged.

## When the free window closes

Either move to Oracle Always Free (`../oracle/README.md`) or accept the bill. The env contract is
identical, so it is a `docker compose down` here and an `up -d` there, plus a data restore.
