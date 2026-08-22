---
'@velchat/feature-realtime': major
'@velchat/common': minor
'@velchat/config': minor
'@velchat/feature-group-channel': minor
'@velchat/realtime-service': minor
---

Harden the WebSocket fabric: authorize inbound frames, index delivery, and bound abuse.

`ws-fabric.ts` is the highest-privilege surface in the system — it authenticates every socket and
its inbound frames mutate state other users can see — and it shipped with **no test at all**. It now
has 25, against a real HTTP server and a real WebSocket client.

- **Inbound frames are authorized, not just authenticated.** `delivered`, `read`, `typing` and
  `skdm` each name a conversation, and a valid token says nothing about whether the sender belongs
  to it. Anyone could previously force blue ticks in a stranger's chat. Every such frame now checks
  membership and **fails closed** — an unavailable membership service denies, and so does a missing
  resolver.
- **Verification no longer degrades.** Without a public key the fabric rejects every connection
  instead of falling back to `jwt.decode`, which had turned a missing env var into "forged tokens
  are valid".
- **Delivery is indexed by user** rather than scanning every socket on the pod for each frame.
- **Inbound is bounded**: a 64 KB frame cap (`ws` defaults to 100 MB), an optional Origin allowlist,
  and a per-connection token bucket — each typing frame costs a fan-out and each ping a registry
  write, so an unbounded client is an amplification lever.
- The duplicate registry write per heartbeat is gone: the TTL is refreshed on one path only.

Adds `@AllowInternal()` for service-to-service calls. The fabric resolves membership over HTTP, but
that endpoint is user-guarded, so it was sending no credential, getting 401, reading `[]`, and
silently not delivering messages whenever the Valkey projection was cold. Endpoints opt in
individually and the secret is compared in constant time, so a leaked secret is not a master key and
a prefix cannot pass. Locally the secret is generated into `.velchat-dev-keys/` alongside the JWT
pair, so authorization is real in development without any configuration.
