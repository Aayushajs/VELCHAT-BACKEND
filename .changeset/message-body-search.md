---
'@velchat/shared-types': minor
'@velchat/chat-service': minor
'@velchat/search-service': minor
---

Full-text search now matches message body for server-readable (enterprise/channel) messages.
chat carries plaintext on message.sent only when a tenant is set and the message is not encrypted;
personal E2EE messages never carry text (§A18.2). Send DTO gains tenantId + encrypted.
