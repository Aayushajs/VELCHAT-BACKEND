# @velchat/shared-types

## 0.3.0

### Minor Changes

- 7615923: Full-text search now matches message body for server-readable (enterprise/channel) messages.
  chat carries plaintext on message.sent only when a tenant is set and the message is not encrypted;
  personal E2EE messages never carry text (§A18.2). Send DTO gains tenantId + encrypted.

## 0.2.0

### Minor Changes

- 2eb83c0: search-service: files, channels, people, and typeahead (suggest) search alongside messages, each
  ACL-scoped. Indexes are built from the event stream. Additive event enrichment: conversation.created
  carries name/visibility; new typed channel.updated + file.deleted payloads.
