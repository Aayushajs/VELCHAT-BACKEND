# @velchat/chat-service

## 0.4.2

### Patch Changes

- Updated dependencies [eb9f1d0]
  - @velchat/database@0.2.3

## 0.4.1

### Patch Changes

- Updated dependencies [45ac2f4]
  - @velchat/database@0.2.2

## 0.4.0

### Minor Changes

- 62fddaf: Chat extras (§A4.1/§B15): pin/unpin messages (conversation-scoped), star/save messages (per-user),
  and per-user conversation state — archive, pin-chat-to-top, and mute (8h / 1w / always / off).

## 0.3.0

### Minor Changes

- a824aeb: E2EE decryption-failure resend protocol (§G1-1): a recipient device that can't decrypt a message can
  ask the sender to re-encrypt it in a fresh ratchet, with bounded retries; once exhausted the message
  is surfaced as unrecoverable instead of being silently lost. The server only transports the request
  and the opaque re-encrypted ciphertext — it never sees plaintext.

### Patch Changes

- Updated dependencies [a45d90d]
  - @velchat/database@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [37f122c]
  - @velchat/cache@0.2.0

## 0.2.0

### Minor Changes

- Phase 8/9 features: AI translation service (cache + language prefs), automation-service (bots, slash
  commands, workflows, reminders, durable job runner), chat polls, mail campaigns + branded templates,
  FCM push routing, and env-driven integration scripts.

### Patch Changes

- Updated dependencies
  - @velchat/database@0.2.0
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
  - @velchat/cache@0.1.1
