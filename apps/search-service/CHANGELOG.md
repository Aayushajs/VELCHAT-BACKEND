# @velchat/search-service

## 0.4.0

### Minor Changes

- 68dd778: Message reactions, edit, and delete (§B15): reaction add/remove, sender-only edit with history,
  delete-for-everyone tombstone + delete-for-me hide. Emits message.reaction.\*/edited/deleted; search
  re-indexes edits and purges deletes. Personal E2EE never leaks plaintext to the index.

### Patch Changes

- Updated dependencies [aa2e770]
- Updated dependencies [68dd778]
  - @velchat/shared-types@0.4.0

## 0.3.0

### Minor Changes

- 7615923: Full-text search now matches message body for server-readable (enterprise/channel) messages.
  chat carries plaintext on message.sent only when a tenant is set and the message is not encrypted;
  personal E2EE messages never carry text (§A18.2). Send DTO gains tenantId + encrypted.

### Patch Changes

- Updated dependencies [676071e]
- Updated dependencies [7615923]
  - @velchat/common@0.2.1
  - @velchat/shared-types@0.3.0
  - @velchat/event-bus@0.1.3
  - @velchat/search@0.1.3

## 0.2.0

### Minor Changes

- 2eb83c0: search-service: files, channels, people, and typeahead (suggest) search alongside messages, each
  ACL-scoped. Indexes are built from the event stream. Additive event enrichment: conversation.created
  carries name/visibility; new typed channel.updated + file.deleted payloads.

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
- Updated dependencies [2eb83c0]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2
  - @velchat/shared-types@0.2.0
  - @velchat/event-bus@0.1.2
  - @velchat/search@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
  - @velchat/search@0.1.1
