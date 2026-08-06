# @velchat/shared-types

## 0.5.0

### Minor Changes

- e1a4b61: Unified AI gateway (one self-hosted model server, HMAC-signed, timeout-bounded) + real-time call
  translation: STT to per-listener translate to optional TTS, emitting call.caption which the realtime
  gateway routes to each listener in their own language. See docs/AI-SERVER.md. New config:
  AI_BASE_URL/API_KEY/HMAC_SECRET/TIMEOUT_MS.

## 0.4.0

### Minor Changes

- aa2e770: Feature Flag & Remote-Config platform (docs/FEATURE-FLAGS.md), MongoDB-only, hosted in
  automation-service: flags/remote-config/experiments, %/country/platform/version/role rollout, user
  overrides, segments, dependencies, kill switch, scheduled enable/disable, emergency rollback,
  versioning + audit, global maintenance mode + announcement, Valkey-cached pure evaluation engine, and
  the featureflag.changed event. Gateway routes /feature-flags to automation-service.
- 68dd778: Message reactions, edit, and delete (§B15): reaction add/remove, sender-only edit with history,
  delete-for-everyone tombstone + delete-for-me hide. Emits message.reaction.\*/edited/deleted; search
  re-indexes edits and purges deletes. Personal E2EE never leaks plaintext to the index.

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
