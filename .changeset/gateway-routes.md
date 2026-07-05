---
'@velchat/api-gateway': patch
---

Route the new group-channel conversation-detail + notif + role endpoints to group-channel (they
previously fell through to chat). messages + pins stay with chat.
