# @velchat/config

## 0.3.0

### Minor Changes

- e1a4b61: Unified AI gateway (one self-hosted model server, HMAC-signed, timeout-bounded) + real-time call
  translation: STT to per-listener translate to optional TTS, emitting call.caption which the realtime
  gateway routes to each listener in their own language. See docs/AI-SERVER.md. New config:
  AI_BASE_URL/API_KEY/HMAC_SECRET/TIMEOUT_MS.

## 0.2.0

### Minor Changes

- bb29628: WebRTC ICE endpoint (GET /calls/ice-servers): self-hosted coturn STUN + short-lived TURN
  credentials for raw/P2P calls. New optional config: STUN_URLS, TURN_URLS, TURN_SECRET,
  TURN_TTL_SECONDS. Free/self-hosted only; no new dependency.

## 0.1.2

### Patch Changes

- d9578ad: API gateway is now a real edge: reverse-proxy routing to every backend service (ordered rules resolve
  the /users and /conversations prefixes that are shared across services), auth/tenant header
  pass-through, per-IP rate limiting, and clean 502s. CORS is enabled on all services via CORS_ORIGINS
  (added a pre-listen `configure` hook to bootstrapService) so web/desktop clients work out of the box.

## 0.1.1

### Patch Changes

- Phase 8/9 features: AI translation service (cache + language prefs), automation-service (bots, slash
  commands, workflows, reminders, durable job runner), chat polls, mail campaigns + branded templates,
  FCM push routing, and env-driven integration scripts.
