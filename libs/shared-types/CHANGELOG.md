# @velchat/shared-types

## 0.2.0

### Minor Changes

- 2eb83c0: search-service: files, channels, people, and typeahead (suggest) search alongside messages, each
  ACL-scoped. Indexes are built from the event stream. Additive event enrichment: conversation.created
  carries name/visibility; new typed channel.updated + file.deleted payloads.
