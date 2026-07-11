# @velchat/api-gateway

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
