# @velchat/api-gateway

## 0.2.3

### Patch Changes

- aa2e770: Feature Flag & Remote-Config platform (docs/FEATURE-FLAGS.md), MongoDB-only, hosted in
  automation-service: flags/remote-config/experiments, %/country/platform/version/role rollout, user
  overrides, segments, dependencies, kill switch, scheduled enable/disable, emergency rollback,
  versioning + audit, global maintenance mode + announcement, Valkey-cached pure evaluation engine, and
  the featureflag.changed event. Gateway routes /feature-flags to automation-service.
- Updated dependencies [aa2e770]
- Updated dependencies [68dd778]
  - @velchat/shared-types@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [676071e]
- Updated dependencies [7615923]
  - @velchat/common@0.2.1
  - @velchat/shared-types@0.3.0
  - @velchat/event-bus@0.1.3

## 0.2.1

### Patch Changes

- aa79115: Route the new group-channel conversation-detail + notif + role endpoints to group-channel (they
  previously fell through to chat). messages + pins stay with chat.

## 0.2.0

### Minor Changes

- d9578ad: API gateway is now a real edge: reverse-proxy routing to every backend service (ordered rules resolve
  the /users and /conversations prefixes that are shared across services), auth/tenant header
  pass-through, per-IP rate limiting, and clean 502s. CORS is enabled on all services via CORS_ORIGINS
  (added a pre-listen `configure` hook to bootstrapService) so web/desktop clients work out of the box.

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
- Updated dependencies [2eb83c0]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2
  - @velchat/shared-types@0.2.0
  - @velchat/event-bus@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
