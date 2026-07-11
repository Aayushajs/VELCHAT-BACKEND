---
'@velchat/ai-service': minor
'@velchat/shared-types': minor
'@velchat/realtime-gateway': minor
'@velchat/config': minor
---

Unified AI gateway (one self-hosted model server, HMAC-signed, timeout-bounded) + real-time call
translation: STT to per-listener translate to optional TTS, emitting call.caption which the realtime
gateway routes to each listener in their own language. See docs/AI-SERVER.md. New config:
AI_BASE_URL/API_KEY/HMAC_SECRET/TIMEOUT_MS.
