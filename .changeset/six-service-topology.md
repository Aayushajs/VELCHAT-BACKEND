---
'@velchat/edge-gateway': major
'@velchat/identity-service': major
'@velchat/messaging-service': major
'@velchat/realtime-service': major
'@velchat/content-service': major
'@velchat/platform-service': major
'@velchat/velchat-mono': major
'@velchat/composition': major
'@velchat/infra-context': major
'@velchat/feature-contracts': major
'@velchat/common': minor
'@velchat/config': minor
'@velchat/storage': minor
'@velchat/feature-chat': minor
'@velchat/feature-auth': minor
'@velchat/feature-group-channel': minor
---

Consolidate 13 microservices into 6, and make the deployment portable across Oracle, AWS, Azure and Render — all on free tiers.

**Topology.** Every domain moved into a `libs/feature-*` library, leaving six runtime services that
are thin composition roots: `edge-gateway`, `identity-service` (auth + user + group-channel),
`messaging-service` (chat + notification + search), `realtime-service` (realtime + presence,
Valkey-only), `content-service` (media + status) and `platform-service` (call + automation + ai).
Application code in `apps/` dropped from ~20,000 LOC to under 200. The public API did not move:
`routes.ts` keeps its regexes and only the destination changes, resolved from `SPLIT_PROFILE`.

**Deployment profiles.** `mono` (one process, fits a 1 GB box), `axis6` (the six services) and
`full13` (rollback) select the process layout without touching feature code. `velchat-mono` mounts
the same feature groups through the same assembler as the six — only the process count differs.

**Six S1 defects fixed, all pre-existing:**

- `seq` came from a bare Valkey `INCR` with no durable source. A restart or eviction reset it, and
  because the mobile client skips a `(conversation_id, seq)` it already holds, the failure mode was
  **silent message loss**. It now re-seeds from `MAX(seq)` in Mongo.
- 11 of 13 services had **no authentication at all**, and chat took `senderId` from the request
  body. Authentication is now default-deny via a global guard, and a service refuses to boot without
  `JWT_PUBLIC_PEM`.
- The WebSocket fabric read a variable that is not in the config schema, so it was always undefined
  and fell back to `jwt.decode` — accepting forged tokens on every socket.
- `group-channel` read the same missing variable and therefore rejected every request.
- The event bus marked events processed _before_ handling them, losing them on a crash, and had no
  `XAUTOCLAIM` recovery for entries stuck mid-processing.
- Class-level `@UseGuards` on two controllers prevented the merged service from booting at all.

**Portability.** New `azure-blob` storage adapter (Azure Blob is the one target that is not
S3-compatible), written against the REST API with Shared Key auth so it adds no dependency.
`deploy/` is now one directory per target — `oracle/`, `aws/`, `azure/`, `render/` — over a shared
edge config and a single env contract, with verified free-tier limits in `deploy/PORTABILITY.md`.
