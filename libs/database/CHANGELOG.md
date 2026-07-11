# @velchat/database

## 0.2.7

### Patch Changes

- @velchat/common@0.3.1

## 0.2.6

### Patch Changes

- Updated dependencies [0ec403d]
  - @velchat/common@0.3.0

## 0.2.5

### Patch Changes

- 676071e: Boot no longer hangs on an unreachable datastore: bounded connect timeouts + error listeners on
  Postgres/Mongo/Valkey clients, and parallel boot connect with a hard per-dependency cap.
- Updated dependencies [676071e]
  - @velchat/common@0.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
  - @velchat/common@0.2.0

## 0.2.3

### Patch Changes

- eb9f1d0: Collaboration Clips + Canvas (§A4.7): post short audio/video clips to a conversation (referencing a
  media-service upload), and create/edit collaborative canvas docs with optimistic-concurrency versioning.

## 0.2.2

### Patch Changes

- 45ac2f4: Screen-share remote control (§A4.4, Teams-style): a viewer can request control of the sharer's
  screen; the sharer grants/denies; either side releases/revokes. Server signals the state
  transitions (call.control.\* events); actual input relay stays client-side over WebRTC.

## 0.2.1

### Patch Changes

- a45d90d: Collaboration Lists (§A4.7): lightweight structured task/tracking lists attached to a channel/DM —
  create lists, add/update/complete/reorder items with optional assignee + due date. Postgres-backed
  in automation-service.

## 0.2.0

### Minor Changes

- Phase 8/9 features: AI translation service (cache + language prefs), automation-service (bots, slash
  commands, workflows, reminders, durable job runner), chat polls, mail campaigns + branded templates,
  FCM push routing, and env-driven integration scripts.

### Patch Changes

- @velchat/common@0.1.1
