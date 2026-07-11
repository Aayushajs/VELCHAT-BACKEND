# @velchat/realtime-gateway

## 0.3.0

### Minor Changes

- e1a4b61: Unified AI gateway (one self-hosted model server, HMAC-signed, timeout-bounded) + real-time call
  translation: STT to per-listener translate to optional TTS, emitting call.caption which the realtime
  gateway routes to each listener in their own language. See docs/AI-SERVER.md. New config:
  AI_BASE_URL/API_KEY/HMAC_SECRET/TIMEOUT_MS.

### Patch Changes

- Updated dependencies [e1a4b61]
  - @velchat/shared-types@0.5.0
  - @velchat/config@0.3.0
  - @velchat/common@0.3.1
  - @velchat/event-bus@0.1.5
  - @velchat/cache@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [0ec403d]
- Updated dependencies [bb29628]
  - @velchat/common@0.3.0
  - @velchat/config@0.2.0
  - @velchat/cache@0.2.3
  - @velchat/event-bus@0.1.4

## 0.2.2

### Patch Changes

- Updated dependencies [aa2e770]
- Updated dependencies [68dd778]
  - @velchat/shared-types@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [676071e]
- Updated dependencies [7615923]
  - @velchat/common@0.2.1
  - @velchat/cache@0.2.2
  - @velchat/shared-types@0.3.0
  - @velchat/event-bus@0.1.3

## 0.2.0

### Minor Changes

- ae68190: Ephemeral typing fan-out (§C4): inbound `typing` ws signal fans typing.started/stopped to the
  other conversation members; ephemeral (dropped under backpressure, never stored).

## 0.1.3

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
- Updated dependencies [2eb83c0]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2
  - @velchat/shared-types@0.2.0
  - @velchat/cache@0.2.1
  - @velchat/event-bus@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [37f122c]
  - @velchat/cache@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
  - @velchat/cache@0.1.1
