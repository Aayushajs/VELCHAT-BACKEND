# @velchat/automation-service

## 0.5.0

### Minor Changes

- aa2e770: Feature Flag & Remote-Config platform (docs/FEATURE-FLAGS.md), MongoDB-only, hosted in
  automation-service: flags/remote-config/experiments, %/country/platform/version/role rollout, user
  overrides, segments, dependencies, kill switch, scheduled enable/disable, emergency rollback,
  versioning + audit, global maintenance mode + announcement, Valkey-cached pure evaluation engine, and
  the featureflag.changed event. Gateway routes /feature-flags to automation-service.

### Patch Changes

- Updated dependencies [aa2e770]
- Updated dependencies [68dd778]
  - @velchat/shared-types@0.4.0

## 0.4.2

### Patch Changes

- Updated dependencies [676071e]
- Updated dependencies [7615923]
  - @velchat/common@0.2.1
  - @velchat/database@0.2.5
  - @velchat/shared-types@0.3.0
  - @velchat/event-bus@0.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
- Updated dependencies [2eb83c0]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2
  - @velchat/shared-types@0.2.0
  - @velchat/database@0.2.4
  - @velchat/event-bus@0.1.2

## 0.4.0

### Minor Changes

- eb9f1d0: Collaboration Clips + Canvas (§A4.7): post short audio/video clips to a conversation (referencing a
  media-service upload), and create/edit collaborative canvas docs with optimistic-concurrency versioning.

### Patch Changes

- Updated dependencies [eb9f1d0]
  - @velchat/database@0.2.3

## 0.3.1

### Patch Changes

- Updated dependencies [45ac2f4]
  - @velchat/database@0.2.2

## 0.3.0

### Minor Changes

- a45d90d: Collaboration Lists (§A4.7): lightweight structured task/tracking lists attached to a channel/DM —
  create lists, add/update/complete/reorder items with optional assignee + due date. Postgres-backed
  in automation-service.

### Patch Changes

- Updated dependencies [a45d90d]
  - @velchat/database@0.2.1

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
