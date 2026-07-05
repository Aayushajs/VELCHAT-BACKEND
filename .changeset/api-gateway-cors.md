---
'@velchat/api-gateway': minor
'@velchat/common': minor
'@velchat/config': patch
---

API gateway is now a real edge: reverse-proxy routing to every backend service (ordered rules resolve
the /users and /conversations prefixes that are shared across services), auth/tenant header
pass-through, per-IP rate limiting, and clean 502s. CORS is enabled on all services via CORS_ORIGINS
(added a pre-listen `configure` hook to bootstrapService) so web/desktop clients work out of the box.
