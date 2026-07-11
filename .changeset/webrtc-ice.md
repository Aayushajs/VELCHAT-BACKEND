---
'@velchat/call-service': minor
'@velchat/config': minor
---

WebRTC ICE endpoint (GET /calls/ice-servers): self-hosted coturn STUN + short-lived TURN
credentials for raw/P2P calls. New optional config: STUN_URLS, TURN_URLS, TURN_SECRET,
TURN_TTL_SECONDS. Free/self-hosted only; no new dependency.
