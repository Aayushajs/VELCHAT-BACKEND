---
'@velchat/realtime-gateway': minor
---

Ephemeral typing fan-out (§C4): inbound `typing` ws signal fans typing.started/stopped to the
other conversation members; ephemeral (dropped under backpressure, never stored).
