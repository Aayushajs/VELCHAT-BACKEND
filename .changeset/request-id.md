---
'@velchat/common': minor
---

Central request-id correlation: every success + error envelope and error log now carries a
`requestId` (from inbound x-request-id / OTel traceparent, else generated) plus an x-request-id
response header. No per-handler wiring; no new dependency.
