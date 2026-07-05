# @velchat/search-service

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
