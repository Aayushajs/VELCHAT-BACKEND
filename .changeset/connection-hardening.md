---
'@velchat/common': patch
'@velchat/cache': patch
'@velchat/database': patch
---

Boot no longer hangs on an unreachable datastore: bounded connect timeouts + error listeners on
Postgres/Mongo/Valkey clients, and parallel boot connect with a hard per-dependency cap.
