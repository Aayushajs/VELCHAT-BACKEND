# @velchat/media-service

## 0.3.1

### Patch Changes

- Updated dependencies [e1a4b61]
  - @velchat/shared-types@0.5.0
  - @velchat/config@0.3.0
  - @velchat/common@0.3.1
  - @velchat/event-bus@0.1.5
  - @velchat/storage@0.2.1
  - @velchat/database@0.2.7

## 0.3.0

### Minor Changes

- 2b1d811: Memory-safe streaming media upload: putObjectStream on the storage port + S3/Cloudinary adapters,
  and PUT /media/uploads/:id/stream that streams source → storage without buffering the whole file
  (size-capped + hashed on the fly). No new dependency.

### Patch Changes

- Updated dependencies [2b1d811]
- Updated dependencies [0ec403d]
- Updated dependencies [bb29628]
  - @velchat/storage@0.2.0
  - @velchat/common@0.3.0
  - @velchat/config@0.2.0
  - @velchat/database@0.2.6
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
  - @velchat/database@0.2.5
  - @velchat/shared-types@0.3.0
  - @velchat/event-bus@0.1.3
  - @velchat/storage@0.1.3

## 0.2.0

### Minor Changes

- c3d39ff: media-service: conversation media gallery, owner delete with content-hash refcount GC, view-once
  consume (§C22, replay-proof 410), and transcode/thumbnail write-back emitting file.transcoded.
  @velchat/common gains GoneError (410).

### Patch Changes

- 2eb83c0: search-service: files, channels, people, and typeahead (suggest) search alongside messages, each
  ACL-scoped. Indexes are built from the event stream. Additive event enrichment: conversation.created
  carries name/visibility; new typed channel.updated + file.deleted payloads.
- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
- Updated dependencies [2eb83c0]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2
  - @velchat/shared-types@0.2.0
  - @velchat/database@0.2.4
  - @velchat/event-bus@0.1.2
  - @velchat/storage@0.1.2

## 0.1.4

### Patch Changes

- Updated dependencies [eb9f1d0]
  - @velchat/database@0.2.3

## 0.1.3

### Patch Changes

- Updated dependencies [45ac2f4]
  - @velchat/database@0.2.2

## 0.1.2

### Patch Changes

- Updated dependencies [a45d90d]
  - @velchat/database@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/database@0.2.0
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
  - @velchat/storage@0.1.1
