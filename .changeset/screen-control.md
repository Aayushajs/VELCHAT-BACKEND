---
'@velchat/call-service': minor
'@velchat/database': patch
---

Screen-share remote control (§A4.4, Teams-style): a viewer can request control of the sharer's
screen; the sharer grants/denies; either side releases/revokes. Server signals the state
transitions (call.control.\* events); actual input relay stays client-side over WebRTC.
