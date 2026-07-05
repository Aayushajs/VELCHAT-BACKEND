---
'@velchat/search-service': minor
'@velchat/shared-types': minor
'@velchat/group-channel-service': patch
'@velchat/media-service': patch
---

search-service: files, channels, people, and typeahead (suggest) search alongside messages, each
ACL-scoped. Indexes are built from the event stream. Additive event enrichment: conversation.created
carries name/visibility; new typed channel.updated + file.deleted payloads.
