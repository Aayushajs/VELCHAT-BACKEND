# @velchat/common

## 0.2.1

### Patch Changes

- 676071e: Boot no longer hangs on an unreachable datastore: bounded connect timeouts + error listeners on
  Postgres/Mongo/Valkey clients, and parallel boot connect with a hard per-dependency cap.

## 0.2.0

### Minor Changes

- d9578ad: API gateway is now a real edge: reverse-proxy routing to every backend service (ordered rules resolve
  the /users and /conversations prefixes that are shared across services), auth/tenant header
  pass-through, per-IP rate limiting, and clean 502s. CORS is enabled on all services via CORS_ORIGINS
  (added a pre-listen `configure` hook to bootstrapService) so web/desktop clients work out of the box.
- c3d39ff: media-service: conversation media gallery, owner delete with content-hash refcount GC, view-once
  consume (§C22, replay-proof 410), and transcode/thumbnail write-back emitting file.transcoded.
  @velchat/common gains GoneError (410).

### Patch Changes

- Updated dependencies [d9578ad]
  - @velchat/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/config@0.1.1
