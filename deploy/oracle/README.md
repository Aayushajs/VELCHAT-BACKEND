# VelChat on Oracle Cloud Always Free — runbook

One always-on VM, ₹0/month, forever. No Pay-As-You-Go, and none of the $300 trial credits, so
nothing changes when they expire.

For AWS / Azure / Render see [`../PORTABILITY.md`](../PORTABILITY.md).

---

## 0. What you are getting

|           |                                                                              |
| --------- | ---------------------------------------------------------------------------- |
| Compute   | `VM.Standard.A1.Flex` — 2 OCPU ARM / 12 GB (the whole Always Free allowance) |
| Storage   | 200 GB block (50 boot + 150 data), 20 GB Object Storage                      |
| Network   | 1 reserved public IP, 10 TB/month egress, free Let's Encrypt TLS via Caddy   |
| Running   | 6 VelChat services + Postgres + Mongo + Valkey + Caddy + a maintenance job   |
| Footprint | ~2.5 GB idle, ~4.5 GB peak → **~7.5 GB headroom**                            |

Two limits that are _not_ solvable inside Always Free, stated up front so they are not a surprise
later:

- **Idle reclamation.** Oracle may reclaim an Always Free instance whose 95th-percentile CPU stays
  under 20% over 7 days. The maintenance job does ~90 min/day of genuinely useful work which
  probably clears that bar, but Oracle does not document how it samples, so this is **not** treated
  as a guarantee. The real answer is §6: recovery that is automated and rehearsed nightly.
- **No HA.** One VM. RPO 5–15 min, RTO 35–45 min _if_ A1 capacity is available when you need it.

---

## 1. Create the account

1. Sign up at <https://www.oracle.com/cloud/free/>.
2. **Choose `ap-mumbai-1` (Mumbai) as your home region.** This is effectively permanent, and Always
   Free compute can only be created in the home region. Mumbai has the best India-wide latency;
   Hyderabad is the fallback only if you cannot get A1 capacity in Mumbai within ~72 hours.
3. Skip the upgrade prompts. Everything below stays inside Always Free.

## 2. Get the VM (expect to retry)

"Out of host capacity" is the normal first answer for A1 — the shape is in constant demand. Do not
debug it; loop until it succeeds.

```bash
export COMPARTMENT_ID=ocid1.compartment...
export SUBNET_ID=ocid1.subnet...
export IMAGE_ID=ocid1.image...          # Ubuntu 22.04, aarch64
export SSH_KEY_FILE=~/.ssh/id_rsa.pub
bash deploy/oracle/scripts/launch-retry.sh      # run under tmux and walk away
```

Then open 80/443 in the VCN security list **and** in the instance firewall — Oracle's Ubuntu images
ship with iptables rules that silently drop inbound traffic, which looks exactly like a broken app:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Prepare the host

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER" && newgrp docker

# 150 GB data volume, attached in the console, then:
sudo mkfs.ext4 /dev/oracleoci/oraclevdb
sudo mkdir -p /data && sudo mount /dev/oracleoci/oraclevdb /data
echo '/dev/oracleoci/oraclevdb /data ext4 defaults,_netdev,nofail 0 2' | sudo tee -a /etc/fstab
```

## 4. Configure

```bash
git clone <your-repo> velchat && cd velchat
cp deploy/oracle/.env.example deploy/oracle/.env
```

Fill in `deploy/oracle/.env`. The values that will stop the deploy if you skip them:

```bash
# Passwords
openssl rand -base64 24        # → POSTGRES_PASSWORD (also inside POSTGRES_URL)
openssl rand -base64 24        # → MONGO_PASSWORD    (also inside MONGO_URL)

# JWT keypair. REQUIRED: every service verifies tokens itself and refuses to boot without the
# public half. Leaving these unset also makes auth mint an ephemeral key per restart, which logs
# every user out on every deploy.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.key
openssl rsa -in jwt.key -pubout -out jwt.pub
```

`JWT_PRIVATE_PEM` is a secret and only identity-service needs it. `JWT_PUBLIC_PEM` is public and
**every** service needs it.

Object Storage: create a **Customer Secret Key** (Profile → User settings → Customer Secret Keys)
and use it as `S3_ACCESS_KEY` / `S3_SECRET_KEY`. Oracle Object Storage speaks the S3 API, so
`STORAGE_PROVIDER=s3` works with no code change — the same adapter AWS uses.

Point your DNS `A` record at the reserved public IP and set `DOMAIN`; Caddy then gets a free
Let's Encrypt certificate on first boot.

## 5. Deploy

```bash
docker compose -f deploy/oracle/compose.yml --env-file deploy/oracle/.env pull
docker compose -f deploy/oracle/compose.yml --env-file deploy/oracle/.env up -d
docker compose -f deploy/oracle/compose.yml ps
```

Verify — in this order, because each step rules out a different layer:

```bash
curl -s localhost:3001/health                     # edge-gateway is up
for p in 3002 3004 3006 3008 3010; do curl -s localhost:$p/health; echo; done
curl -s https://$DOMAIN/health                    # TLS + Caddy + routing
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/chat/conversations/x/messages
                                                  # expect 401 — the request reached messaging
                                                  # and its guard rejected it. 502 = routing wrong.
```

## 6. Backups and the recovery drill

```bash
crontab -e
0 2 * * * cd /home/ubuntu/velchat && bash deploy/oracle/scripts/backup.sh  >> /var/log/velchat-backup.log 2>&1
0 3 * * * cd /home/ubuntu/velchat && bash deploy/oracle/scripts/restore.sh "$(date -u -d yesterday +\%Y\%m\%d)T020000Z" >> /var/log/velchat-restore.log 2>&1
```

The restore drill runs **every night** into throwaway databases. A backup that has never been
restored is a hope, not a backup — and this is also the recovery path you would use after a
reclamation, so it is the one thing worth exercising daily.

Valkey is intentionally not backed up: after the durable-`seq` fix it holds no durable state.
`seq:*` re-seeds from `MAX(seq)` in Mongo, the connection registry rebuilds as clients reconnect,
and typing/presence are ephemeral.

To recover onto a fresh VM: repeat §2–§5, then `bash deploy/oracle/scripts/restore.sh <STAMP> --live`.
Take a **custom image** of the configured VM now (Instance → More actions → Create custom image) so
that path is "launch from image", ~5 minutes, instead of a rebuild.

## 7. Operating notes

```bash
docker compose -f deploy/oracle/compose.yml logs -f messaging-service   # one service
docker stats --no-stream                                                # memory vs the caps
docker compose -f deploy/oracle/compose.yml pull && \
  docker compose -f deploy/oracle/compose.yml up -d                     # rolling update
```

- **Do not raise the memory limits** without checking `docker stats` first. Two are load-bearing:
  Mongo's `wiredTigerCacheSizeGB=0.5` (its default would claim ~5.5 GB here) and Valkey's
  `noeviction` (evicting a `seq:*` key causes silent client-side message loss).
- **Watch CPU p95.** If it sits under 20% for a week you are exposed to reclamation. `docker stats`
  and the maintenance-job duration are the signals.
- **Never set `AUTH_DEV_INSECURE=true`** here. It is refused in production, but do not try.
- **Costs.** Set an OCI Budget with an alert at $1. Nothing in this setup should ever bill, so any
  charge means something was provisioned outside Always Free.
