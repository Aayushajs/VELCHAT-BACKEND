---
'@velchat/shared-types': minor
'@velchat/chat-service': minor
'@velchat/search-service': minor
---

Message reactions, edit, and delete (§B15): reaction add/remove, sender-only edit with history,
delete-for-everyone tombstone + delete-for-me hide. Emits message.reaction.\*/edited/deleted; search
re-indexes edits and purges deletes. Personal E2EE never leaks plaintext to the index.
